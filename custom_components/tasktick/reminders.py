"""The payload TaskTick hands to HA Reminders.

Stdlib only, like the other pure modules here, so what a reminder says, where it
opens and what its button does can be asserted in a test that runs anywhere
Python does.

The job is split between the two integrations on purpose. Home Assistant's HA
Reminders owns delivery: the trigger, the resend loop, the snooze buttons, the
notification group. This module owns the parts that are TaskTick's own: the deep
link into the app, the icon that tells one of these apart from the rest, and the
acknowledge action that completes the task or checks in the habit.

The link is the same one TaskTick's own push notifications open
(`src/lib/reminder-notification.ts`), so a reminder delivered by Home Assistant
lands on the same screen as one delivered by Web Push. The action calls TaskTick's
own services back, which is why nothing here needs a second credential.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime, time as dtime
from typing import Any
from urllib.parse import quote

#: The services of the integration this one hands reminders to.
REMINDERS_DOMAIN = "ha_reminders"
REMINDERS_CREATE = "create"
REMINDERS_UPDATE = "update"
REMINDERS_DELETE = "delete"
#: The one-off notification service: it sends a notification and stores nothing,
#: which is what makes it usable as a transport rather than a second schedule.
#: Older HA Reminders releases do not have it, and its absence is how this
#: integration knows not to claim TaskTick's reminders (see `delivery.py`).
REMINDERS_NOTIFY = "notify"

#: The integration's own icon: `mdi:check-circle-outline`, the one its sensors
#: already carry, so a TaskTick reminder is recognisable in a shade full of other
#: notifications. An `mdi:` name or a URL, overridable per reminder.
DEFAULT_ICON = "mdi:check-circle-outline"

#: TaskTick's own services, called back by the acknowledge button.
COMPLETE_TASK = "tasktick.complete_task"
CHECK_IN_HABIT = "tasktick.check_in_habit"

#: What the acknowledge button promises, per target. "Done" would be a lie on an
#: event, which has nothing to complete, and on a habit, which is checked in for a
#: day rather than finished.
ACKNOWLEDGE_TITLES = {
    "task": "Complete",
    "habit": "Check in",
    "event": "Dismiss",
}

#: The trigger and delivery fields of `ha_reminders.create`, passed straight
#: through: they are spelled the same on both sides, and TaskTick has no opinion
#: about them beyond letting an automation set them. Everything else this
#: integration's `create_reminder` accepts, it derives itself.
PASSTHROUGH = (
    "trigger_type",
    "time",
    "start_date",
    "stop_date",
    "every_x_days",
    "exclude_days_of_week",
    "zone_entity_id",
    "person_entity_ids",
    "time_window_start",
    "time_window_end",
    "snooze_delays",
    "snooze_text",
    "notification_group",
    "enabled",
    "one_shot",
    "wait_time_if_no_action",
    "notification_count",
)

#: The passthrough fields that take a list. The Home Assistant selectors for these
#: emit several values, but an automation written by hand may pass one — and
#: `list("3")` is `["3"]` only by accident, so a bare string has to be wrapped
#: rather than coerced.
LIST_FIELDS = ("exclude_days_of_week", "person_entity_ids", "snooze_delays")


def app_link(origin: str, target: str, target_id: str, day: str = "") -> str:
    """The app URL that opens one thing.

    Mirrors the app's own deep links: a task or a habit opens its bottom sheet, an
    event opens the calendar on the day it belongs to with the event's card
    showing. An event with no day cannot be pointed at, so the calendar opens
    rather than the wrong date.
    """
    base = origin.rstrip("/")
    quoted = quote(target_id, safe="")
    if target == "task":
        return f"{base}/tasks?task={quoted}"
    if target == "habit":
        return f"{base}/habits?habit={quoted}"
    if target == "event" and day:
        return f"{base}/calendar?date={quote(day, safe='')}&event={quoted}"
    return base


def acknowledge_actions(
    target: str, target_id: str, day: str = ""
) -> list[dict[str, Any]]:
    """What the acknowledge button runs, if it runs anything.

    An event has nothing to complete, so it gets no action: its button only clears
    the notification, which is what HA Reminders' own acknowledge already does.
    """
    if target == "task":
        return [{"service": COMPLETE_TASK, "data": {"task_id": target_id}}]
    if target == "habit":
        data: dict[str, Any] = {"habit": target_id}
        if day:
            # The day the reminder was for, so a check-in read the next morning
            # still counts for the right one.
            data["date"] = day
        return [{"service": CHECK_IN_HABIT, "data": data}]
    return []


def as_list(value: Any) -> list[Any]:
    """One value or several, as a list.

    `vol.Coerce(list)` would turn a single entity id into its characters, which is
    how one mistyped id becomes a dozen that match nothing.
    """
    if isinstance(value, list):
        return value
    if isinstance(value, tuple | set):
        return list(value)
    return [value]


def pick_target(
    data: Mapping[str, Any],
    *,
    task: str,
    habit: str,
    event: str,
    date_key: str,
) -> tuple[str, str, str]:
    """Which thing a reminder is about, and the local day it opens on.

    The field names arrive from the caller rather than being spelled again here,
    so the service is the one place they are written down. Raises `ValueError`
    when none of them was given (a reminder with no subject cannot be completed
    from its own notification) or more than one was. The date parameter is named
    `date_key` because `date` is the type of the value it returns.
    """
    day = data.get(date_key) or ""
    if isinstance(day, date | datetime):
        day = day.isoformat()
    day = str(day)

    given = [
        (target, data[field])
        for target, field in (("task", task), ("habit", habit), ("event", event))
        if data.get(field)
    ]
    if len(given) != 1:
        raise ValueError(
            f"give exactly one of {task}, {habit} or {event}, so the reminder "
            "knows what it is about"
        )
    target, value = given[0]
    if target == "event" and not day:
        raise ValueError(
            f"a reminder for an event needs {date_key}: the calendar link opens on it"
        )
    return target, str(value), day


def reminder_payload(
    *,
    origin: str,
    target: str,
    target_id: str,
    day: str = "",
    title: str = "",
    message: str = "",
    icon: str = "",
    notify_service: str = "",
    user_name: str = "",
    complete: bool = True,
    acknowledge_title: str = "",
) -> dict[str, Any]:
    """The TaskTick half of an `ha_reminders.create` payload.

    Only the keys that carry something are set: HA Reminders drops empty strings
    anyway, and an absent key cannot be mistaken for a deliberate blank.
    """
    payload: dict[str, Any] = {
        "title": title,
        "icon": icon or DEFAULT_ICON,
        "click_url": app_link(origin, target, target_id, day),
    }
    if message:
        payload["message"] = message
    if notify_service:
        payload["notify_service"] = notify_service
    if user_name:
        payload["user_name"] = user_name

    actions = acknowledge_actions(target, target_id, day) if complete else []
    if actions:
        payload["acknowledge_actions"] = actions
    if complete or acknowledge_title:
        # The title matters even with no action of its own: Home Assistant's
        # acknowledge button is always there, and on an event it is the whole
        # interaction — "Dismiss" says what it does, "Done" would not.
        payload["acknowledge_action_title"] = acknowledge_title or ACKNOWLEDGE_TITLES.get(
            target, "Done"
        )
    return payload


def habit_day(occurrence_key: str) -> str:
    """The day a habit reminder's occurrence key names, or ``""``.

    The app spells a habit occurrence as ``<date>:<minute>`` (see
    `src/lib/reminder-notification.ts`), and the date is the day a check-in from
    the notification has to write — the notification can be tapped the next
    morning, so it cannot be read back off the clock. A key that is not shaped
    that way yields nothing rather than a wrong date.
    """
    day = occurrence_key.split(":", 1)[0]
    try:
        date.fromisoformat(day)
    except ValueError:
        return ""
    return day


def notification_payload(*, origin: str, notification: Mapping[str, Any]) -> dict[str, Any]:
    """One of TaskTick's own notifications, as an `ha_reminders.notify` payload.

    The app posts its `NotificationPayload` (`src/server/services/notifications.ts`)
    verbatim, because that is the same object its Web Push transport renders: the
    title, the body, the app path a tap opens, and `data` carrying the source, the
    item's id and the occurrence. Everything TaskTick-specific is derived here, so
    a reminder delivered through Home Assistant lands on the same screen and its
    button runs the same service call as one delivered by the app itself.

    Raises `ValueError` for a notification this cannot deliver — one with no title,
    or one whose `data` does not name what it is about, since a notification
    nothing can act on is worse than the caller's own fallback.
    """
    data = notification.get("data") or {}
    if not isinstance(data, Mapping):
        raise ValueError("a notification's data must be an object")

    target = str(data.get("source") or "")
    target_id = str(data.get("sourceId") or "")
    if target not in ACKNOWLEDGE_TITLES or not target_id:
        raise ValueError("a notification needs data.source and data.sourceId")

    title = str(notification.get("title") or "")
    if not title:
        raise ValueError("a notification needs a title")

    payload: dict[str, Any] = {
        "title": title,
        "icon": DEFAULT_ICON,
        "acknowledge_action_title": ACKNOWLEDGE_TITLES[target],
    }

    body = str(notification.get("body") or "")
    if body:
        payload["message"] = body

    path = str(notification.get("url") or "")
    if path.startswith("/"):
        # The app sends an app-absolute path, which is right for its own worker and
        # useless in a notification: only the integration knows the origin the user
        # reaches this instance on.
        payload["click_url"] = f"{origin.rstrip('/')}{path}"

    day = habit_day(str(data.get("occurrenceKey") or "")) if target == "habit" else ""
    actions = acknowledge_actions(target, target_id, day)
    if actions:
        payload["acknowledge_actions"] = actions
    return payload


def schedule_fields(data: Mapping[str, Any]) -> dict[str, Any]:
    """The trigger and delivery fields, as HA Reminders reads them.

    A `date` or a `time` object is not JSON and HA Reminders parses these as ISO
    strings, so the conversion happens here rather than in the service handler.
    """
    fields: dict[str, Any] = {}
    for name in PASSTHROUGH:
        value = data.get(name)
        if value is None:
            continue
        if isinstance(value, date | datetime | dtime):
            value = value.isoformat()
        elif name in LIST_FIELDS:
            value = as_list(value)
        fields[name] = value
    return fields


def validate_trigger(payload: Mapping[str, Any]) -> None:
    """Refuse the two ways a reminder is created and then never fires.

    HA Reminders validates this too, but from inside the service call, where the
    error names a model field rather than the automation that set it.
    """
    if payload.get("trigger_type", "time") == "time":
        if not payload.get("time"):
            raise ValueError("a time reminder needs a time")
        return
    if not payload.get("zone_entity_id"):
        raise ValueError("a zone reminder needs a zone_entity_id")
    if not payload.get("person_entity_ids"):
        raise ValueError("a zone reminder needs the person_entity_ids to watch")
