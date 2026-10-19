"""Intent handlers for Assist.

The sentence templates live in the companion ``custom_sentences/en/tasktick.yaml``
and are installed into ``<config>/custom_sentences/en/`` by the
``tasktick.install_sentences`` service — Home Assistant only ever loads custom
sentences from the config directory, never from an integration package.

Tasks are also reachable through the built-in todo intents, because the todo
platform exposes a list entity per TaskTick list. The intents here add what that
cannot express: **habits**, which have no Home Assistant domain of their own, and
task creation with a day and time in one sentence.
"""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.helpers import intent
from homeassistant.util import dt as dt_util

from .coordinator import TaskTickCoordinator, get_coordinator
from .util import (
    find_similar,
    normalize_word,
    parse_day_text,
    parse_spoken_number,
    parse_time_text,
    slot_text,
    slot_value,
)

_LOGGER = logging.getLogger(__name__)

#: Long lists are unusable spoken aloud, so the read-back stops here and says how
#: many were left out rather than reciting forty titles.
MAX_SPOKEN_TASKS = 10

#: Every intent this integration answers, in the order an LLM should consider
#: them. One list, because it is consumed three ways — the handlers registered
#: below, the LLM tools in `llm.py`, and the tests — and a name that appears in
#: two of the three fails silently: a tool that never appears, or a sentence that
#: never matches. `tests/test_intents.py` asserts the registered handlers are
#: exactly this set.
INTENT_TYPES: tuple[str, ...] = (
    "TaskTickAddTask",
    "TaskTickListTasks",
    "TaskTickCompleteTask",
    "TaskTickDeleteTask",
    "TaskTickCheckInHabit",
    "TaskTickHabitStatus",
    "TaskTickCreateEvent",
)


def async_setup_intents(hass: HomeAssistant) -> None:
    """Register every TaskTick intent handler."""
    intent.async_register(hass, TaskTickAddTaskIntent())
    intent.async_register(hass, TaskTickListTasksIntent())
    intent.async_register(hass, TaskTickCompleteTaskIntent())
    intent.async_register(hass, TaskTickDeleteTaskIntent())
    intent.async_register(hass, TaskTickCheckInHabitIntent())
    intent.async_register(hass, TaskTickHabitStatusIntent())
    intent.async_register(hass, TaskTickCreateEventIntent())


class _TaskTickIntent(intent.IntentHandler):
    """Shared resolution helpers."""

    def _coordinator(self, hass: HomeAssistant) -> TaskTickCoordinator:
        try:
            return get_coordinator(hass, allow_multiple=True)
        except Exception as err:  # noqa: BLE001 - surface as a spoken error
            raise intent.IntentHandleError(
                "The TaskTick integration is not configured yet."
            ) from err

    def _resolve_list(self, hass: HomeAssistant, spoken: str) -> str:
        coordinator = self._coordinator(hass)
        if not spoken:
            # No list named: the inbox, or whatever is marked default.
            for task_list in coordinator.data.lists:
                if task_list.get("isInbox"):
                    return task_list["id"]
            if coordinator.data.lists:
                return coordinator.data.lists[0]["id"]
            raise intent.IntentHandleError("There are no TaskTick lists.")

        target = normalize_word(spoken)
        for task_list in coordinator.data.lists:
            if normalize_word(task_list["name"]) == target:
                return task_list["id"]
        partial = [
            task_list
            for task_list in coordinator.data.lists
            if target in normalize_word(task_list["name"])
        ]
        if len(partial) == 1:
            return partial[0]["id"]
        if len(partial) > 1:
            names = ", ".join(item["name"] for item in partial)
            raise intent.IntentHandleError(f"Several lists match: {names}.")
        raise intent.IntentHandleError(f"I could not find a list called {spoken}.")

    def _resolve_task(self, hass: HomeAssistant, spoken: str) -> dict[str, Any]:
        coordinator = self._coordinator(hass)
        target = normalize_word(spoken)
        if not target:
            raise intent.IntentHandleError("I need a task title.")

        exact = [
            task for task in coordinator.data.tasks if normalize_word(task["title"]) == target
        ]
        if len(exact) == 1:
            return exact[0]
        if len(exact) > 1:
            raise intent.IntentHandleError(
                "There are several tasks with that title, please be more specific."
            )

        partial = [
            task for task in coordinator.data.tasks if target in normalize_word(task["title"])
        ]
        if len(partial) == 1:
            return partial[0]
        if len(partial) > 1:
            names = ", ".join(task["title"] for task in partial[:5])
            raise intent.IntentHandleError(
                f"Several tasks match: {names}. Please say the full title."
            )

        # Speech recognition mangles the odd word, so a near-miss is worth a try
        # before giving up — this is the same tolerance the reminders integration
        # uses, and the reason it exists there applies here unchanged.
        similar = find_similar(coordinator.data.tasks, spoken, name_attr="title")
        if similar is not None:
            return similar

        raise intent.IntentHandleError(f"I could not find a task called {spoken}.")

    def _resolve_habit(self, hass: HomeAssistant, spoken: str) -> dict[str, Any]:
        coordinator = self._coordinator(hass)
        target = normalize_word(spoken)
        if not target:
            raise intent.IntentHandleError("I need a habit name.")

        for habit in coordinator.data.habits:
            if normalize_word(habit["name"]) == target:
                return habit
        partial = [
            habit for habit in coordinator.data.habits if target in normalize_word(habit["name"])
        ]
        if len(partial) == 1:
            return partial[0]
        if len(partial) > 1:
            names = ", ".join(habit["name"] for habit in partial[:5])
            raise intent.IntentHandleError(f"Several habits match: {names}.")
        similar = find_similar(coordinator.data.habits, spoken)
        if similar is not None:
            return similar
        raise intent.IntentHandleError(f"I could not find a habit called {spoken}.")

    def _resolve_calendar(self, hass: HomeAssistant, spoken: str) -> str | None:
        coordinator = self._coordinator(hass)
        if not spoken:
            for calendar in coordinator.data.calendars:
                if calendar.get("isDefault") and not calendar.get("readOnly"):
                    return calendar["id"]
            writable = [
                calendar for calendar in coordinator.data.calendars if not calendar.get("readOnly")
            ]
            return writable[0]["id"] if writable else None

        target = normalize_word(spoken)
        for calendar in coordinator.data.calendars:
            if normalize_word(calendar["name"]) == target:
                if calendar.get("readOnly"):
                    raise intent.IntentHandleError(f"{calendar['name']} is read-only.")
                return calendar["id"]
        raise intent.IntentHandleError(f"I could not find a calendar called {spoken}.")


class TaskTickAddTaskIntent(_TaskTickIntent):
    """Add a task, optionally to a named list and for a day and time."""

    intent_type = "TaskTickAddTask"
    description = (
        "Add a task to the user's TaskTick list. Put what the task is in 'title'. "
        "Name the list in 'list' when the user says which one. Set 'day' to today "
        "or tomorrow, and 'time' for a specific time such as 5pm."
    )

    @property
    def slot_schema(self) -> dict:
        return {
            vol.Required("title"): vol.Any(str, int, float),
            vol.Optional("list"): str,
            vol.Optional("day"): str,
            vol.Optional("time"): vol.Any(str, int, float),
        }

    async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
        hass = intent_obj.hass
        coordinator = self._coordinator(hass)
        slots = self.async_validate_slots(intent_obj.slots)

        title = slot_text(slots, "title")
        if not title:
            raise intent.IntentHandleError("I need to know what the task is.")

        payload: dict[str, Any] = {"title": title}
        list_name = slot_text(slots, "list")
        if list_name:
            payload["listId"] = self._resolve_list(hass, list_name)

        speech = f"Added {title}."
        day_text = slot_text(slots, "day")
        time_text = slot_text(slots, "time")

        if day_text or time_text:
            today = dt_util.now().date()
            day = parse_day_text(day_text, today=today) if day_text else today
            if day is None:
                raise intent.IntentHandleError(
                    f"I did not understand the day {day_text}. Try today or tomorrow."
                )
            if time_text:
                parsed = parse_time_text(time_text)
                if parsed is None:
                    raise intent.IntentHandleError(
                        f"I did not understand the time {time_text}."
                    )
                moment = dt_util.as_local(
                    dt_util.start_of_local_day(day) + timedelta(
                        hours=parsed.hour, minutes=parsed.minute
                    )
                )
                payload["dueAtMs"] = moment.timestamp() * 1000
                speech = f"Added {title} for {moment.strftime('%A at %-I:%M %p')}."
            else:
                payload["dueDate"] = day.isoformat()
                speech = f"Added {title} for {day.strftime('%A')}."

        await coordinator.client.async_create_task(payload)
        await coordinator.async_request_refresh()

        response = intent_obj.create_response()
        response.async_set_speech(speech)
        return response


class TaskTickListTasksIntent(_TaskTickIntent):
    """Read back the open tasks, optionally for one list."""

    intent_type = "TaskTickListTasks"
    description = (
        "List the user's open TaskTick tasks. Name a list in 'list' to read only "
        "that one."
    )

    @property
    def slot_schema(self) -> dict:
        return {vol.Optional("list"): str}

    async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
        hass = intent_obj.hass
        coordinator = self._coordinator(hass)
        slots = self.async_validate_slots(intent_obj.slots)

        list_name = slot_text(slots, "list")
        if list_name:
            list_id = self._resolve_list(hass, list_name)
            tasks = coordinator.data.tasks_in_list(list_id)
            where = coordinator.data.list_by_id(list_id)
            label = where["name"] if where else "that list"
        else:
            tasks = coordinator.data.tasks
            label = "all your lists"

        if not tasks:
            speech = f"You have no open tasks in {label}."
        else:
            shown = tasks[:MAX_SPOKEN_TASKS]
            lines = ", ".join(f"{i}. {task['title']}" for i, task in enumerate(shown, start=1))
            speech = f"You have {len(tasks)} open tasks in {label}: {lines}."
            if len(tasks) > len(shown):
                speech += f" And {len(tasks) - len(shown)} more."

        response = intent_obj.create_response()
        response.async_set_speech(speech)
        return response


class TaskTickCompleteTaskIntent(_TaskTickIntent):
    """Mark a task complete, by title."""

    intent_type = "TaskTickCompleteTask"
    description = "Mark one of the user's TaskTick tasks as complete, by its title."

    @property
    def slot_schema(self) -> dict:
        return {vol.Required("title"): vol.Any(str, int, float)}

    async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
        hass = intent_obj.hass
        coordinator = self._coordinator(hass)
        slots = self.async_validate_slots(intent_obj.slots)
        task = self._resolve_task(hass, slot_text(slots, "title"))

        result = await coordinator.client.async_complete_task(task["id"])
        await coordinator.async_request_refresh()

        response = intent_obj.create_response()
        if result.get("recurred"):
            # A repeating task rolls forward instead of finishing; saying
            # "completed" would be wrong and the user would go looking for it.
            response.async_set_speech(
                f"Done. {task['title']} repeats, so I moved it to its next occurrence."
            )
        else:
            response.async_set_speech(f"Marked {task['title']} as complete.")
        return response


class TaskTickDeleteTaskIntent(_TaskTickIntent):
    """Delete a task, by title."""

    intent_type = "TaskTickDeleteTask"
    description = "Delete one of the user's TaskTick tasks, by its title."

    @property
    def slot_schema(self) -> dict:
        return {vol.Required("title"): vol.Any(str, int, float)}

    async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
        hass = intent_obj.hass
        coordinator = self._coordinator(hass)
        slots = self.async_validate_slots(intent_obj.slots)
        task = self._resolve_task(hass, slot_text(slots, "title"))

        await coordinator.client.async_delete_task(task["id"])
        await coordinator.async_request_refresh()

        response = intent_obj.create_response()
        response.async_set_speech(f"Deleted {task['title']}.")
        return response


class TaskTickCheckInHabitIntent(_TaskTickIntent):
    """Record a habit check-in.

    This is the one thing the todo platform cannot do, and the most natural
    thing to say: "I went for a run" is a check-in, not a todo item.
    """

    intent_type = "TaskTickCheckInHabit"
    description = (
        "Record a check-in for one of the user's TaskTick habits, by its name. "
        "Use this when the user says they did, finished or completed a habit."
    )

    @property
    def slot_schema(self) -> dict:
        return {vol.Required("habit"): str}

    async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
        hass = intent_obj.hass
        coordinator = self._coordinator(hass)
        slots = self.async_validate_slots(intent_obj.slots)
        habit = self._resolve_habit(hass, slot_text(slots, "habit"))

        # `delta` rather than an absolute count: correct for a boolean habit
        # (target 1, so one increment meets it) and for a count habit, which
        # accumulates instead of being reset to whatever we assumed.
        result = await coordinator.client.async_check_in_habit(habit["id"], {"delta": 1})
        await coordinator.async_request_refresh()

        response = intent_obj.create_response()
        if result.get("doneToday"):
            response.async_set_speech(f"Nice. {habit['name']} is done for today.")
        else:
            progress = result.get("habit", {}).get("progress")
            if isinstance(progress, (int, float)):
                response.async_set_speech(
                    f"Checked in {habit['name']}. That is {round(progress * 100)} percent of today's goal."
                )
            else:
                response.async_set_speech(f"Checked in {habit['name']}.")
        return response


class TaskTickHabitStatusIntent(_TaskTickIntent):
    """Report habit streaks and what is still outstanding."""

    intent_type = "TaskTickHabitStatus"
    description = (
        "Report the user's TaskTick habits: their streaks and whether today's "
        "target is met. Name one in 'habit', or leave it out for all of them."
    )

    @property
    def slot_schema(self) -> dict:
        return {vol.Optional("habit"): str}

    async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
        hass = intent_obj.hass
        coordinator = self._coordinator(hass)
        slots = self.async_validate_slots(intent_obj.slots)

        habit_name = slot_text(slots, "habit")
        if habit_name:
            habit = self._resolve_habit(hass, habit_name)
            speech = self._describe(habit)
        elif not coordinator.data.habits:
            speech = "You have no habits yet."
        else:
            parts = [self._describe(habit) for habit in coordinator.data.habits]
            speech = " ".join(parts)

        response = intent_obj.create_response()
        response.async_set_speech(speech)
        return response

    @staticmethod
    def _describe(habit: dict[str, Any]) -> str:
        streak = int(habit.get("streak") or 0)
        name = habit["name"]
        if habit.get("doneToday"):
            head = f"{name} is done today"
        else:
            head = f"{name} is not done yet today"
        if streak:
            return f"{head}, on a {streak} day streak."
        return f"{head}."


class TaskTickCreateEventIntent(_TaskTickIntent):
    """Create a calendar event.

    The time is required: an event without one is a task, and guessing an hour
    would put something in the user's calendar they did not ask for.
    """

    intent_type = "TaskTickCreateEvent"
    description = (
        "Add an event to one of the user's TaskTick calendars. Put the event name "
        "in 'title', the calendar in 'calendar' when named, the day in 'day' "
        "(today or tomorrow) and the start time in 'time'."
    )

    @property
    def slot_schema(self) -> dict:
        return {
            vol.Required("title"): vol.Any(str, int, float),
            vol.Optional("calendar"): str,
            vol.Optional("day"): str,
            vol.Required("time"): vol.Any(str, int, float),
            vol.Optional("minutes"): vol.Any(str, int, float),
        }

    async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
        hass = intent_obj.hass
        coordinator = self._coordinator(hass)
        slots = self.async_validate_slots(intent_obj.slots)

        title = slot_text(slots, "title")
        if not title:
            raise intent.IntentHandleError("I need to know what the event is.")

        calendar_id = self._resolve_calendar(hass, slot_text(slots, "calendar"))
        if calendar_id is None:
            raise intent.IntentHandleError(
                "There is no writable TaskTick calendar to add that to."
            )

        today = dt_util.now().date()
        day_text = slot_text(slots, "day")
        day = parse_day_text(day_text, today=today) if day_text else today
        if day is None:
            raise intent.IntentHandleError(
                f"I did not understand the day {day_text}. Try today or tomorrow."
            )

        parsed_time = parse_time_text(slot_text(slots, "time"))
        if parsed_time is None:
            raise intent.IntentHandleError(
                f"I did not understand the time {slot_text(slots, 'time')}."
            )

        start = dt_util.as_local(
            dt_util.start_of_local_day(day)
            + timedelta(hours=parsed_time.hour, minutes=parsed_time.minute)
        )
        duration = parse_spoken_number(slot_value(slots, "minutes")) or 60
        end = start + timedelta(minutes=duration)

        await coordinator.client.async_create_event(
            {
                "calendarId": calendar_id,
                "summary": title,
                "startMs": start.timestamp() * 1000,
                "endMs": end.timestamp() * 1000,
            }
        )
        await coordinator.async_request_refresh()

        response = intent_obj.create_response()
        response.async_set_speech(
            f"Added {title} for {start.strftime('%A at %-I:%M %p')}."
        )
        return response
