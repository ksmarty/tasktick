"""Tests for the two habit buttons.

What is worth pinning here is the payload the buttons write. The app decides
"done" with its own arithmetic — `entryWeight(goalType, count, value)` summed
against `periodTarget(habit)` — so a button that guesses the wrong field either
never completes a duration habit or completes one the user meant to leave alone.
The three goal types are all covered, and "not done" is a count of 0, which is
the value the app deletes the day's entry for.

The unique ids are pinned too: the first button keeps the `_check_in` id it had
when it was the only one, so an upgrade updates the entity that is already on
somebody's dashboard instead of leaving it behind as an orphan.

The client is a fake and no entity is written to a state machine, so this
exercises the payload and the entity's identity and nothing else: no network, no
server, no recorder.
"""

from __future__ import annotations

import asyncio

from ha_version import require_supported_ha

require_supported_ha()

from ha_fakes import config_entry  # noqa: E402
from homeassistant.core import HomeAssistant  # noqa: E402

from custom_components.tasktick.button import (  # noqa: E402
    INCOMPLETE_CHECK_IN,
    TaskTickHabitCompleteButton,
    TaskTickHabitIncompleteButton,
    completion_check_in,
)
from custom_components.tasktick.const import DOMAIN  # noqa: E402
from custom_components.tasktick.coordinator import TaskTickCoordinator, TaskTickData  # noqa: E402

SNAPSHOT = {
    "me": {"name": "Kyle"},
    "lists": [{"id": "inbox", "name": "Inbox", "isInbox": True}],
    "tasks": [],
    "habits": [
        {
            "id": "h1",
            "name": "Go for a run",
            "goalType": "count",
            "goalTarget": 8,
            "unit": "km",
            "doneToday": False,
            "progress": 0.25,
        },
        {
            "id": "h2",
            "name": "Read",
            "goalType": "duration",
            "goalTarget": 30,
            "unit": "min",
            "doneToday": False,
            "progress": 0.0,
        },
        {
            "id": "h3",
            "name": "Water the plants",
            "goalType": "boolean",
            "goalTarget": 1,
            "doneToday": True,
            "progress": 1.0,
        },
    ],
    "calendars": [],
    "stats": {"completedByDay": [], "totalCompleted": 0, "currentStreakDays": 0},
}


class FakeClient:
    """Records the check-in it was handed."""

    origin = "http://tasktick.test"

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    async def async_check_in_habit(self, habit_id, check_in=None):
        self.calls.append((habit_id, check_in))
        return {"doneToday": True, "habit": {}}


class TestCompletionPayload:
    def test_a_count_habit_completes_at_its_target(self) -> None:
        assert completion_check_in({"goalType": "count", "goalTarget": 8}) == {"count": 8.0}

    def test_a_duration_habit_completes_its_tracked_value(self) -> None:
        # The app sums `value` for a duration habit, not `count`; writing count
        # would leave the habit at one minute against a thirty minute target.
        assert completion_check_in({"goalType": "duration", "goalTarget": 30}) == {
            "value": 30.0
        }

    def test_a_boolean_habit_completes_with_one(self) -> None:
        assert completion_check_in({"goalType": "boolean", "goalTarget": 1}) == {"count": 1.0}

    def test_a_habit_with_no_declared_goal_still_completes(self) -> None:
        # Older snapshots and a habit created without a goal: one is "done".
        assert completion_check_in({}) == {"count": 1.0}

    def test_a_target_of_zero_is_not_written_as_a_completion(self) -> None:
        # A count of 0 is the *clear* signal, so it must never be what "done"
        # produces — that would make the two buttons identical.
        assert completion_check_in({"goalType": "count", "goalTarget": 0}) == {"count": 1.0}

    def test_incomplete_clears_the_entry(self) -> None:
        assert INCOMPLETE_CHECK_IN == {"count": 0.0}


async def _build(client: FakeClient):
    hass = HomeAssistant("/tmp/tasktick-button-test")
    hass.config.config_dir = "/tmp/tasktick-button-test"

    coordinator = TaskTickCoordinator(hass, config_entry(), client)
    coordinator.async_set_updated_data(TaskTickData.from_snapshot(SNAPSHOT))

    refreshes: list[int] = []

    async def _refresh(*args, **kwargs):
        refreshes.append(1)

    coordinator.async_request_refresh = _refresh  # type: ignore[method-assign]

    hass.data[DOMAIN] = {"test": coordinator}
    return hass, coordinator, refreshes


def _run(coro):
    return asyncio.run(coro)


def _with(fn):
    """Run an async test body with a fresh hass + fake client."""

    async def _body():
        client = FakeClient()
        hass, coordinator, refreshes = await _build(client)
        try:
            return await fn(client, coordinator, refreshes)
        finally:
            await coordinator.async_shutdown()
            await hass.async_stop()

    return _run(_body())


class TestPressing:
    def test_complete_presses_the_day_to_the_target(self) -> None:
        async def body(client, coordinator, refreshes):
            button = TaskTickHabitCompleteButton(coordinator, coordinator.config_entry, "h1")
            await button.async_press()
            return client.calls, refreshes

        calls, refreshes = _with(body)
        assert calls == [("h1", {"count": 8.0})]
        assert refreshes, "a press should ask the coordinator for a poll"

    def test_incomplete_clears_the_day(self) -> None:
        async def body(client, coordinator, refreshes):
            button = TaskTickHabitIncompleteButton(coordinator, coordinator.config_entry, "h2")
            await button.async_press()
            return client.calls, refreshes

        calls, refreshes = _with(body)
        assert calls == [("h2", {"count": 0.0})]
        assert refreshes

    def test_the_two_buttons_are_distinct_entities(self) -> None:
        async def body(client, coordinator, refreshes):
            done = TaskTickHabitCompleteButton(coordinator, coordinator.config_entry, "h1")
            undone = TaskTickHabitIncompleteButton(coordinator, coordinator.config_entry, "h1")
            return done.unique_id, undone.unique_id, done.name, undone.name

        done_id, undone_id, done_name, undone_name = _with(body)
        # The old single button's id, so an upgrade keeps that entity.
        assert done_id == "test_h1_check_in"
        assert undone_id == "test_h1_incomplete"
        assert done_name == "Mark as completed"
        assert undone_name == "Mark as incomplete"

    def test_a_deleted_habit_leaves_both_buttons_unavailable(self) -> None:
        async def body(client, coordinator, refreshes):
            done = TaskTickHabitCompleteButton(coordinator, coordinator.config_entry, "h1")
            undone = TaskTickHabitIncompleteButton(coordinator, coordinator.config_entry, "h1")
            before = (done.available, undone.available)

            trimmed = dict(SNAPSHOT)
            trimmed["habits"] = [habit for habit in SNAPSHOT["habits"] if habit["id"] != "h1"]
            coordinator.async_set_updated_data(TaskTickData.from_snapshot(trimmed))
            return before, (done.available, undone.available)

        before, after = _with(body)
        assert before == (True, True)
        assert after == (False, False)

    def test_pressing_a_vanished_habit_writes_nothing(self) -> None:
        async def body(client, coordinator, refreshes):
            button = TaskTickHabitCompleteButton(coordinator, coordinator.config_entry, "h1")
            trimmed = dict(SNAPSHOT)
            trimmed["habits"] = []
            coordinator.async_set_updated_data(TaskTickData.from_snapshot(trimmed))
            await button.async_press()
            return client.calls

        assert _with(body) == []
