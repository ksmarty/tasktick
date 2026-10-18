"""The reminder mirror: TaskTick's schedule, delivered by HA Reminders.

## Why this exists

TaskTick can send its own notifications, but on iPhone an installed PWA gets no
reliable background wake-up, so a reminder that has to survive a locked phone is
better sent by Home Assistant's companion app. This module is what makes that
automatic: the integration asks TaskTick what it *would* remind about, and
mirrors each entry into HA Reminders, whose notification carries a Complete/Check
in button and a tap that opens the app at the right screen.

Nothing is configured for this. The integration reads the schedule every poll and
writes the difference, so a reminder typed in TaskTick shows up in Home Assistant
without anyone creating an automation.

## Why it reconciles rather than creates

The schedule is the truth and HA Reminders is a copy of it, so each poll compares
the two and applies the difference — create what is new, update what moved, delete
what is gone. Two rules keep that safe:

  - **A failed read deletes nothing.** Reconciliation only runs on a schedule that
    arrived; a TaskTick that is briefly unreachable must not wipe the reminders
    that are already delivering.
  - **A fingerprint decides an update.** The payload is hashed, so an unchanged
    reminder is left completely alone and a poll does not rewrite twenty reminders
    every minute.

## Why the key, and not the reminder id

TaskTick's ``key`` names the recurrence slot (``habit:<id>:420``), while
``reminder_id`` is HA Reminders' own row id. Keeping the mapping in Home
Assistant's store — see ``mirror_store`` in ``__init__`` — is what lets a moved
reminder be *updated* rather than deleted and re-created, and that matters more
than it sounds: re-creating a reminder loses nothing, but updating one keeps the
notification the user may already be looking at.

The mapping lives in Home Assistant rather than TaskTick on purpose. TaskTick is
the schedule; Home Assistant knows which of its own reminders correspond to it,
and that knowledge must not survive in the app if the integration is removed.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable, Mapping
from zoneinfo import ZoneInfo

from .reminders import (
    ACKNOWLEDGE_TITLES,
    DEFAULT_ICON,
    acknowledge_actions,
    app_link,
)

_LOGGER = logging.getLogger(__name__)

# The form HA Reminders stores a time in, and the one it parses back.
CLOCK_FORMAT = "%H:%M:%S"

# The sources the mirror covers. All three, because a task, a habit and a
# calendar event are all things a reminder can be attached to; a source this
# integration does not mirror must never appear here, since claiming it would
# silence TaskTick's own notification for something nobody then delivers.
MIRRORED_SOURCES = ("task", "habit", "event")

# Python's date.weekday() counts from Monday; the app counts from Sunday. Every
# conversion goes through these two, so the off-by-one lives in exactly one place.
_SUNDAY_FIRST_TO_MONDAY_FIRST = {day: (day + 6) % 7 for day in range(7)}


def weekday_for_ha(app_weekday: int) -> int:
    """Convert the app's weekday (0 = Sunday) to HA Reminders' (0 = Monday)."""
    if not 0 <= app_weekday <= 6:
        raise ValueError(f"{app_weekday!r} is not a weekday")
    return _SUNDAY_FIRST_TO_MONDAY_FIRST[app_weekday]


def clock_and_day(fire_at_ms: float, zone: str) -> tuple[str, str]:
    """The wall clock and the calendar day of an instant, in a zone.

    The mirror sends *when* to fire, not *what instant*: HA Reminders schedules on
    local wall-clock time, so the offset of the moment has to be resolved here.
    """
    moment = datetime.fromtimestamp(fire_at_ms / 1000, tz=ZoneInfo(zone))
    return moment.strftime(CLOCK_FORMAT), moment.strftime("%Y-%m-%d")


def fingerprint(payload: Mapping[str, Any]) -> str:
    """A stable hash of a reminder payload, for "did this actually change?".

    Sorted keys and no whitespace, so two payloads that mean the same thing hash
    the same regardless of how they were built.
    """
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def excluded_days(week_days: Iterable[int] | None) -> list[int]:
    """The HA Reminders ``exclude_days_of_week`` for a set of included weekdays.

    HA Reminders has no "only these days" field — a repeating reminder runs
    ``every_x_days`` and skips the days it is told to skip — so the app's include
    list is inverted here, once, where the two conventions meet.
    """
    if week_days is None:
        return []
    wanted = set(week_days)
    return sorted(weekday_for_ha(day) for day in range(7) if day not in wanted)


def reminder_payload(
    entry: Mapping[str, Any],
    origin: str,
    zone: str,
    *,
    icon: str = DEFAULT_ICON,
    complete: bool = True,
) -> dict[str, Any]:
    """One HA Reminders ``create`` payload for one scheduled reminder.

    This is the automatic twin of the ``create_reminder`` service — same deep
    link, same icon, same acknowledge action — fed from TaskTick's own schedule
    instead of from a service call.
    """
    source = str(entry["source"])
    target_id = str(entry["sourceId"])
    day = str(entry["date"])
    fire_at_ms = float(entry["fireAtMs"])

    clock, local_day = clock_and_day(fire_at_ms, zone)
    repeat = entry.get("repeat") == "daily"

    payload: dict[str, Any] = {
        "title": str(entry["title"]),
        "message": str(entry.get("body") or ""),
        "icon": icon,
        "click_url": app_link(origin, source, target_id, day),
        "enabled": True,
        "time": clock,
        "one_shot": not repeat,
        "start_date": local_day,
    }

    if repeat:
        payload["every_x_days"] = 1
        payload["exclude_days_of_week"] = excluded_days(entry.get("weekDays"))

    # A habit is credited to the day the reminder was *for*, so the day has to
    # travel with the action; a task and an event need nothing but their id.
    actions = acknowledge_actions(source, target_id, day if source == "habit" else "")
    if complete and actions:
        payload["acknowledge_actions"] = actions
    if complete or actions:
        payload["acknowledge_action_title"] = ACKNOWLEDGE_TITLES.get(source, "Done")

    return payload


def desired_reminders(
    entries: Iterable[Mapping[str, Any]],
    origin: str,
    zone: str,
    *,
    icon: str = DEFAULT_ICON,
    complete: bool = True,
) -> dict[str, dict[str, Any]]:
    """Every scheduled reminder, keyed by the stable ``key`` TaskTick gave it."""
    desired: dict[str, dict[str, Any]] = {}
    for entry in entries:
        key = str(entry.get("key") or "").strip()
        if not key:
            # A reminder with no identity cannot be reconciled — it would be
            # re-created on every poll — so it is skipped rather than guessed at.
            _LOGGER.warning("TaskTick returned a reminder with no key; skipping it")
            continue
        desired[key] = reminder_payload(entry, origin, zone, icon=icon, complete=complete)
    return desired


@dataclass
class MirrorPlan:
    """What one reconciliation pass decided to do."""

    create: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    update: list[tuple[str, str, dict[str, Any]]] = field(default_factory=list)
    delete: list[tuple[str, str]] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not (self.create or self.update or self.delete)

    def __str__(self) -> str:
        return f"+{len(self.create)} ~{len(self.update)} -{len(self.delete)}"


def reconcile(
    desired: Mapping[str, Mapping[str, Any]],
    stored: Mapping[str, Mapping[str, Any]],
) -> MirrorPlan:
    """Diff the schedule against what Home Assistant already holds.

    ``stored`` maps a TaskTick key to ``{"reminder_id": ..., "fingerprint": ...}``
    and is Home Assistant's own bookkeeping; anything in it that the schedule no
    longer mentions is deleted, because a reminder TaskTick no longer has is one
    the user has removed or completed.
    """
    plan = MirrorPlan()

    for key, payload in desired.items():
        existing = stored.get(key)
        if existing is None or not existing.get("reminder_id"):
            plan.create.append((key, dict(payload)))
            continue
        if existing.get("fingerprint") != fingerprint(payload):
            plan.update.append((key, str(existing["reminder_id"]), dict(payload)))

    for key, existing in stored.items():
        if key in desired:
            continue
        reminder_id = existing.get("reminder_id")
        if reminder_id:
            plan.delete.append((key, str(reminder_id)))

    return plan
