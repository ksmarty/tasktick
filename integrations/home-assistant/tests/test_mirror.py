"""Tests for the reminder mirror.

Two layers, and they are tested differently on purpose:

  - ``mirror.py`` is pure, so its payloads and its diff are asserted directly.
  - ``mirror_sync.py`` talks to Home Assistant, so it is driven with a fake hass,
    a fake HA Reminders registry and a fake store. What is worth pinning there is
    the set of decisions that are invisible until they go wrong: that a failed
    read deletes nothing, that a failed write suppresses the delivery claim, and
    that an unchanged schedule writes nothing at all.

``Store`` is patched rather than simulated: the point is the mapping's behaviour,
not Home Assistant's storage format.
"""

from __future__ import annotations

import asyncio
import types
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from custom_components.tasktick import mirror, mirror_sync
from custom_components.tasktick.api import TaskTickError
from custom_components.tasktick.mirror import (
    MIRRORED_SOURCES,
    clock_and_day,
    desired_reminders,
    excluded_days,
    fingerprint,
    reconcile,
    weekday_for_ha,
)
from custom_components.tasktick.reminders import ACKNOWLEDGE_TITLES, DEFAULT_ICON

LONDON = ZoneInfo("Europe/London")
ORIGIN = "https://tasks.example.com"


def at_ms(*args: int) -> float:
    """A local London instant, in epoch milliseconds."""
    return datetime(*args, tzinfo=LONDON).timestamp() * 1000


def task_entry(**overrides: Any) -> dict[str, Any]:
    entry = {
        "key": "task:t1:off:-30",
        "source": "task",
        "sourceId": "t1",
        "title": "Take the bins out",
        "body": "Task due",
        "date": "2026-05-12",
        "fireAtMs": at_ms(2026, 5, 12, 20, 30),
        "repeat": "once",
        "minuteOfDay": None,
        "weekDays": None,
    }
    entry.update(overrides)
    return entry


def habit_entry(**overrides: Any) -> dict[str, Any]:
    entry = {
        "key": "habit:h1:420",
        "source": "habit",
        "sourceId": "h1",
        "title": "Meditate",
        "body": "Habit reminder",
        "date": "2026-05-11",
        "fireAtMs": at_ms(2026, 5, 11, 7, 0),
        "repeat": "daily",
        "minuteOfDay": 420,
        # Mon, Wed, Fri in the app's own convention, where 0 is Sunday.
        "weekDays": [1, 3, 5],
    }
    entry.update(overrides)
    return entry


def event_entry(**overrides: Any) -> dict[str, Any]:
    entry = {
        "key": "event:e1:60",
        "source": "event",
        "sourceId": "e1",
        "title": "Standup",
        "body": "Calendar event",
        "date": "2026-05-12",
        "fireAtMs": at_ms(2026, 5, 12, 9, 0),
        "repeat": "once",
        "minuteOfDay": None,
        "weekDays": None,
    }
    entry.update(overrides)
    return entry


# --------------------------------------------------------------------------- #
# Pure: the payload
# --------------------------------------------------------------------------- #


class TestClockAndDay:
    def test_reads_the_instant_in_the_given_zone(self):
        assert clock_and_day(at_ms(2026, 5, 12, 20, 30), "Europe/London") == ("20:30:00", "2026-05-12")

    def test_the_same_instant_in_another_zone_is_another_clock(self):
        # 20:30 in London is 21:30 in Berlin: the notification must fire at the
        # instant, not at the number.
        assert clock_and_day(at_ms(2026, 5, 12, 20, 30), "Europe/Berlin") == ("21:30:00", "2026-05-12")


class TestWeekdays:
    @pytest.mark.parametrize(
        ("app_day", "ha_day"),
        [(0, 6), (1, 0), (2, 1), (3, 2), (4, 3), (5, 4), (6, 5)],
    )
    def test_sunday_first_becomes_monday_first(self, app_day: int, ha_day: int):
        assert weekday_for_ha(app_day) == ha_day

    def test_rejects_a_day_that_is_not_a_day(self):
        with pytest.raises(ValueError):
            weekday_for_ha(7)

    def test_excluding_nothing_when_every_day_is_wanted(self):
        assert excluded_days(None) == []
        assert excluded_days([0, 1, 2, 3, 4, 5, 6]) == []

    def test_inverts_the_week(self):
        # Mon, Wed, Fri wanted -> Tue, Thu, Sat, Sun excluded, Monday first.
        assert excluded_days([1, 3, 5]) == [1, 3, 5, 6]


class TestReminderPayload:
    def test_a_task_reminder_opens_the_task_and_can_finish_it(self):
        payload = mirror.reminder_payload(task_entry(), ORIGIN, "Europe/London")
        assert payload["title"] == "Take the bins out"
        assert payload["message"] == "Task due"
        assert payload["icon"] == DEFAULT_ICON
        assert payload["click_url"] == f"{ORIGIN}/tasks?task=t1"
        assert payload["time"] == "20:30:00"
        assert payload["start_date"] == "2026-05-12"
        assert payload["one_shot"] is True
        assert payload["acknowledge_actions"] == [
            {"service": "tasktick.complete_task", "data": {"task_id": "t1"}}
        ]
        assert payload["acknowledge_action_title"] == ACKNOWLEDGE_TITLES["task"]

    def test_a_daily_habit_repeats_and_carries_the_day_it_is_for(self):
        payload = mirror.reminder_payload(habit_entry(), ORIGIN, "Europe/London")
        assert payload["one_shot"] is False
        assert payload["time"] == "07:00:00"
        assert payload["every_x_days"] == 1
        assert payload["exclude_days_of_week"] == [1, 3, 5, 6]
        assert payload["click_url"] == f"{ORIGIN}/habits?habit=h1"
        assert payload["acknowledge_actions"] == [
            # The day travels with the check-in: a reminder read the next morning
            # still counts for the day it was for.
            {"service": "tasktick.check_in_habit", "data": {"habit": "h1", "date": "2026-05-11"}}
        ]

    def test_an_event_has_no_button_to_press(self):
        payload = mirror.reminder_payload(event_entry(), ORIGIN, "Europe/London")
        assert "acknowledge_actions" not in payload
        assert payload["acknowledge_action_title"] == ACKNOWLEDGE_TITLES["event"]
        assert payload["click_url"] == f"{ORIGIN}/calendar?date=2026-05-12&event=e1"


class TestDesiredReminders:
    def test_keys_the_schedule_by_the_stable_key(self):
        desired = desired_reminders([task_entry(), habit_entry()], ORIGIN, "Europe/London")
        assert sorted(desired) == ["habit:h1:420", "task:t1:off:-30"]

    def test_skips_a_reminder_that_has_no_identity(self):
        # Without a key it could never be reconciled, so it is dropped rather than
        # re-created on every poll.
        assert desired_reminders([task_entry(key="")], ORIGIN, "Europe/London") == {}


# --------------------------------------------------------------------------- #
# Pure: the diff
# --------------------------------------------------------------------------- #


def stored_for(entry: dict[str, Any], reminder_id: str = "rem-1") -> dict[str, Any]:
    payload = mirror.reminder_payload(entry, ORIGIN, "Europe/London")
    return {"reminder_id": reminder_id, "fingerprint": fingerprint(payload)}


class TestReconcile:
    def test_a_new_reminder_is_created(self):
        desired = desired_reminders([task_entry()], ORIGIN, "Europe/London")
        plan = reconcile(desired, {})
        assert [key for key, _ in plan.create] == ["task:t1:off:-30"]
        assert not plan.update and not plan.delete

    def test_an_unchanged_reminder_is_left_alone(self):
        desired = desired_reminders([task_entry()], ORIGIN, "Europe/London")
        plan = reconcile(desired, {"task:t1:off:-30": stored_for(task_entry())})
        assert plan.empty

    def test_a_moved_reminder_is_updated_not_re_created(self):
        desired = desired_reminders([task_entry(fireAtMs=at_ms(2026, 5, 12, 21, 0))], ORIGIN, "Europe/London")
        plan = reconcile(desired, {"task:t1:off:-30": stored_for(task_entry())})
        assert not plan.create
        assert [(key, reminder_id) for key, reminder_id, _ in plan.update] == [("task:t1:off:-30", "rem-1")]
        assert plan.update[0][2]["time"] == "21:00:00"

    def test_a_reminder_that_is_gone_is_deleted(self):
        plan = reconcile({}, {"task:t1:off:-30": stored_for(task_entry())})
        assert plan.delete == [("task:t1:off:-30", "rem-1")]

    def test_a_stored_entry_without_an_id_is_re_created(self):
        # A failed create can leave a key recorded with no reminder behind it.
        plan = reconcile(
            desired_reminders([task_entry()], ORIGIN, "Europe/London"),
            {"task:t1:off:-30": {"fingerprint": "whatever"}},
        )
        assert len(plan.create) == 1

    def test_the_fingerprint_ignores_key_order(self):
        assert fingerprint({"a": 1, "b": 2}) == fingerprint({"b": 2, "a": 1})


# --------------------------------------------------------------------------- #
# The poll
# --------------------------------------------------------------------------- #


class FakeStore:
    def __init__(self) -> None:
        self.data: dict[str, Any] | None = None
        self.saves = 0
        self.removed = False

    async def async_load(self) -> dict[str, Any] | None:
        return self.data

    async def async_save(self, data: dict[str, Any]) -> None:
        self.data = data
        self.saves += 1

    async def async_remove(self) -> None:
        self.data = None
        self.removed = True


class FakeServices:
    """The HA Reminders service registry, recording every call."""

    def __init__(self, *, available: bool = True) -> None:
        self.available = available
        self.calls: list[dict[str, Any]] = []
        self.fail: set[str] = set()
        self.created = 0

    def has_service(self, domain: str, service: str) -> bool:
        return self.available and (domain, service) == ("ha_reminders", "create")

    async def async_call(
        self,
        domain: str,
        service: str,
        data: dict[str, Any],
        blocking: bool = False,
        return_response: bool = False,
    ) -> Any:
        self.calls.append({"service": service, "data": dict(data), "return_response": return_response})
        if service in self.fail:
            raise RuntimeError(f"HA Reminders refused {service}")
        if service == "create":
            self.created += 1
            return {"reminder_id": f"rem-{self.created}"}
        return {} if return_response else None

    @property
    def names(self) -> list[str]:
        return [call["service"] for call in self.calls]


class FakeClient:
    origin = ORIGIN

    def __init__(self, entries: list[dict[str, Any]] | None = None) -> None:
        self.entries = entries or []
        self.claims: list[list[str]] = []
        self.read_error: Exception | None = None

    async def async_scheduled_reminders(self, days: int | None = None) -> list[dict[str, Any]]:
        if self.read_error is not None:
            raise self.read_error
        return list(self.entries)

    async def async_register_reminder_delivery(self, sources: list[str]) -> dict[str, Any]:
        self.claims.append(list(sources))
        return {"sources": sources, "registeredAtMs": 0}


class FakeHass:
    def __init__(self, services: FakeServices) -> None:
        self.services = services
        self.config = types.SimpleNamespace(time_zone="Europe/London")


@pytest.fixture(name="store")
def store_fixture(monkeypatch: pytest.MonkeyPatch) -> FakeStore:
    store = FakeStore()
    monkeypatch.setattr(mirror_sync, "Store", lambda hass, version, key: store)
    return store


def build_mirror(
    monkeypatch: pytest.MonkeyPatch, client: FakeClient, services: FakeServices | None = None
) -> mirror_sync.ReminderMirror:
    hass = FakeHass(services or FakeServices())
    return mirror_sync.ReminderMirror(hass, types.SimpleNamespace(entry_id="entry-1"), client)


def sync(instance: mirror_sync.ReminderMirror) -> None:
    asyncio.run(instance.async_sync())


class TestReminderMirror:
    def test_creates_a_reminder_per_entry_and_claims_delivery(self, monkeypatch, store):
        client = FakeClient([task_entry(), habit_entry()])
        instance = build_mirror(monkeypatch, client)

        sync(instance)

        services = instance.hass.services
        assert services.names == ["create", "create"]
        assert services.calls[0]["return_response"] is True
        assert client.claims == [list(MIRRORED_SOURCES)]
        assert store.data is not None
        assert sorted(store.data["reminders"]) == ["habit:h1:420", "task:t1:off:-30"]

    def test_an_unchanged_schedule_writes_nothing_but_keeps_claiming(self, monkeypatch, store):
        client = FakeClient([task_entry()])
        instance = build_mirror(monkeypatch, client)

        sync(instance)
        services = instance.hass.services
        services.calls.clear()
        sync(instance)

        # The claim is re-sent every poll because it goes stale; the reminder is
        # not rewritten because nothing about it changed.
        assert services.calls == []
        assert len(client.claims) == 2

    def test_the_mapping_survives_a_restart(self, monkeypatch, store):
        first = build_mirror(monkeypatch, FakeClient([task_entry()]))
        sync(first)
        created = first.hass.services.created

        # A fresh mirror over the same storage: the reminder it created must not
        # be created a second time.
        second_services = FakeServices()
        second = build_mirror(monkeypatch, FakeClient([task_entry()]), second_services)
        sync(second)

        assert second_services.created == 0
        assert created == 1

    def test_a_moved_reminder_updates_the_one_it_already_made(self, monkeypatch, store):
        instance = build_mirror(monkeypatch, FakeClient([task_entry()]))
        sync(instance)

        moved = build_mirror(monkeypatch, FakeClient([task_entry(fireAtMs=at_ms(2026, 5, 12, 21, 0))]))
        services = moved.hass.services
        sync(moved)

        assert services.names == ["update"]
        assert services.calls[0]["data"]["reminder_id"] == "rem-1"
        assert services.calls[0]["data"]["time"] == "21:00:00"

    def test_a_reminder_that_left_the_schedule_is_deleted(self, monkeypatch, store):
        first = build_mirror(monkeypatch, FakeClient([task_entry()]))
        sync(first)

        second = build_mirror(monkeypatch, FakeClient([]))
        services = second.hass.services
        sync(second)

        assert services.names == ["delete"]
        assert services.calls[0]["data"] == {"reminder_id": "rem-1"}

    def test_does_nothing_at_all_without_ha_reminders(self, monkeypatch, store):
        # Not even the claim: the app's own notification is the only one there is.
        client = FakeClient([task_entry()])
        instance = mirror_sync.ReminderMirror(
            FakeHass(FakeServices(available=False)), types.SimpleNamespace(entry_id="entry-1"), client
        )

        sync(instance)

        assert instance.hass.services.calls == []
        assert client.claims == []

    def test_a_failed_read_deletes_nothing(self, monkeypatch, store):
        first = build_mirror(monkeypatch, FakeClient([task_entry()]))
        sync(first)

        broken = build_mirror(monkeypatch, FakeClient([]))
        broken.client.read_error = TaskTickError("TaskTick is unreachable")
        services = broken.hass.services
        sync(broken)

        # An instance that is briefly down must not wipe reminders that are
        # already delivering.
        assert services.calls == []
        assert broken.client.claims == []

    def test_a_failed_write_suppresses_the_claim(self, monkeypatch, store):
        client = FakeClient([task_entry()])
        instance = build_mirror(monkeypatch, client)
        instance.hass.services.fail.add("create")

        sync(instance)

        # Claiming delivery on the back of a write that did not land would leave
        # the user with no notification from either side.
        assert client.claims == []
        assert store.data is None

    def test_removal_deletes_what_it_created(self, monkeypatch, store):
        instance = build_mirror(monkeypatch, FakeClient([task_entry(), habit_entry()]))
        sync(instance)

        services = instance.hass.services
        services.calls.clear()
        asyncio.run(instance.async_stop())

        assert services.names == ["delete", "delete"]
        assert store.removed is True

    def test_removal_without_ha_reminders_forgets_the_mapping(self, monkeypatch, store):
        instance = build_mirror(monkeypatch, FakeClient([task_entry()]))
        sync(instance)
        instance.hass.services.available = False

        asyncio.run(instance.async_stop())

        assert store.removed is True
