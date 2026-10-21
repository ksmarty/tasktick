"""Intent handler tests.

Drives the handlers through Home Assistant's real `intent.async_handle`, with
slots in the `{"value": ..., "text": ...}` shape the conversation agent sends —
the same shape a `wildcard: true` sentence list produces.

The client is a fake, so this exercises the handlers and the name resolution and
nothing else: no network, no server.
"""

from __future__ import annotations

import asyncio
import inspect
from datetime import timedelta

import pytest

from ha_version import require_supported_ha

require_supported_ha()

from ha_fakes import config_entry  # noqa: E402
from homeassistant.core import HomeAssistant  # noqa: E402
from homeassistant.helpers import intent  # noqa: E402
from homeassistant.util import dt as dt_util  # noqa: E402

from custom_components.tasktick import intents as intents_module  # noqa: E402
from custom_components.tasktick.const import DOMAIN  # noqa: E402
from custom_components.tasktick.coordinator import TaskTickCoordinator, TaskTickData  # noqa: E402

SNAPSHOT = {
    "me": {"name": "Kyle"},
    "lists": [
        {"id": "inbox", "name": "Inbox", "isInbox": True},
        {"id": "shopping", "name": "Shopping"},
    ],
    "tasks": [
        {"id": "t1", "title": "Buy milk", "listId": "shopping", "priority": "none"},
        {"id": "t2", "title": "Call the dentist", "listId": "inbox", "priority": "high"},
    ],
    "habits": [
        {"id": "h1", "name": "Go for a run", "streak": 4, "doneToday": False},
        {"id": "h2", "name": "Read", "streak": 0, "doneToday": True},
    ],
    "calendars": [
        {"id": "c1", "name": "Personal", "readOnly": False, "isDefault": True},
        {"id": "c2", "name": "Holidays", "readOnly": True, "isDefault": False},
        {"id": "c3", "name": "Work", "readOnly": False, "isDefault": False},
    ],
}


class FakeClient:
    """Records what was asked for and answers plausibly."""

    #: `TaskTickCoordinator.__init__` puts this in the coordinator's name, so a
    #: fake without it fails at construction rather than at the call.
    origin = "http://tasktick.test"

    def __init__(self, *, recurred: bool = False, done_today: bool = True, progress=None):
        self.calls: list[tuple] = []
        self.recurred = recurred
        self.done_today = done_today
        self.progress = progress

    async def async_create_task(self, payload):
        self.calls.append(("create_task", payload))
        return {"id": "task-new", **payload}

    async def async_complete_task(self, task_id):
        self.calls.append(("complete_task", task_id))
        return {"recurred": self.recurred}

    async def async_delete_task(self, task_id):
        self.calls.append(("delete_task", task_id))

    async def async_check_in_habit(self, habit_id, check_in=None):
        self.calls.append(("check_in_habit", habit_id, check_in))
        return {"doneToday": self.done_today, "habit": {"progress": self.progress}}

    async def async_create_event(self, payload):
        self.calls.append(("create_event", payload))
        return {"id": "event-new", **payload}


async def _build(client: FakeClient, *, options: dict | None = None):
    hass = HomeAssistant("/tmp/tasktick-intent-test")
    hass.config.config_dir = "/tmp/tasktick-intent-test"

    coordinator = TaskTickCoordinator(hass, config_entry(options=options), client)
    coordinator.async_set_updated_data(TaskTickData.from_snapshot(SNAPSHOT))

    refreshes: list[int] = []

    async def _refresh(*args, **kwargs):
        refreshes.append(1)

    coordinator.async_request_refresh = _refresh  # type: ignore[method-assign]

    hass.data[DOMAIN] = {"test": coordinator}
    intents_module.async_setup_intents(hass)
    return hass, coordinator, refreshes


def _slot(value):
    return {"value": value, "text": str(value)}


async def _handle(hass, intent_type: str, slots: dict, text: str = ""):
    return await intent.async_handle(
        hass, "conversation", intent_type, slots=slots, text_input=text
    )


def _speech(response) -> str:
    return response.speech["plain"]["speech"]


def _run(coro):
    return asyncio.run(coro)


def _with_client(fn, *, options: dict | None = None, **client_kwargs):
    """Run an async test body with a fresh hass + fake client."""

    async def _body():
        client = FakeClient(**client_kwargs)
        hass, coordinator, refreshes = await _build(client, options=options)
        try:
            return await fn(hass, client, refreshes)
        finally:
            await coordinator.async_shutdown()
            await hass.async_stop()

    return _run(_body())


# -- adding tasks ---------------------------------------------------------- #


def test_add_task_without_a_list_uses_the_inbox() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(
            hass, "TaskTickAddTask", {"title": _slot("buy bread")}, "add a task buy bread"
        )
        return _speech(response), client.calls, refreshes

    speech, calls, refreshes = _with_client(body)
    kind, payload = calls[0]
    assert kind == "create_task"
    assert payload == {"title": "buy bread"}
    assert "buy bread" in speech
    assert refreshes, "a write must refresh the coordinator"


def test_add_task_to_a_named_list() -> None:
    async def body(hass, client, refreshes):
        await _handle(
            hass,
            "TaskTickAddTask",
            {"title": _slot("buy bread"), "list": _slot("shopping")},
        )
        return client.calls

    calls = _with_client(body)
    assert calls[0][1]["listId"] == "shopping"


def test_add_task_for_tomorrow() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(
            hass,
            "TaskTickAddTask",
            {"title": _slot("buy bread"), "day": _slot("tomorrow")},
        )
        return _speech(response), client.calls

    speech, calls = _with_client(body)
    tomorrow = dt_util.now().date() + timedelta(days=1)
    assert calls[0][1]["dueDate"] == tomorrow.isoformat()
    # The handler reads back the day it resolved, not the word that was said:
    # "for Tuesday" is unambiguous where "for tomorrow" is not. Pinned against
    # the resolved weekday so this does not depend on the day it runs.
    assert tomorrow.strftime("%A").lower() in speech.lower()


def test_add_task_with_a_time_sets_a_moment_not_a_day() -> None:
    async def body(hass, client, refreshes):
        await _handle(
            hass,
            "TaskTickAddTask",
            {"title": _slot("buy bread"), "day": _slot("today"), "time": _slot("5pm")},
        )
        return client.calls

    calls = _with_client(body)
    payload = calls[0][1]
    assert "dueAtMs" in payload and "dueDate" not in payload
    local = dt_util.as_local(dt_util.utc_from_timestamp(payload["dueAtMs"] / 1000))
    assert (local.hour, local.minute) == (17, 0)


def test_add_task_rejects_an_unknown_list() -> None:
    async def body(hass, client, refreshes):
        with pytest.raises(intent.IntentHandleError) as caught:
            await _handle(
                hass,
                "TaskTickAddTask",
                {"title": _slot("x"), "list": _slot("atlantis")},
            )
        return str(caught.value)

    message = _with_client(body)
    assert "atlantis" in message


def test_add_task_rejects_an_unknown_day() -> None:
    async def body(hass, client, refreshes):
        with pytest.raises(intent.IntentHandleError) as caught:
            await _handle(
                hass,
                "TaskTickAddTask",
                {"title": _slot("x"), "day": _slot("someday")},
            )
        return str(caught.value)

    message = _with_client(body)
    assert "someday" in message


# -- listing and managing tasks -------------------------------------------- #


def test_list_tasks_speaks_them() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(hass, "TaskTickListTasks", {})
        return _speech(response)

    speech = _with_client(body)
    assert "2 open tasks" in speech
    assert "Buy milk" in speech and "Call the dentist" in speech


def test_list_tasks_in_one_list() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(hass, "TaskTickListTasks", {"list": _slot("shopping")})
        return _speech(response)

    speech = _with_client(body)
    assert "Shopping" in speech
    assert "Buy milk" in speech
    assert "Call the dentist" not in speech


def test_complete_task_by_partial_title() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(
            hass, "TaskTickCompleteTask", {"title": _slot("dentist")}
        )
        return _speech(response), client.calls

    speech, calls = _with_client(body)
    assert calls[0] == ("complete_task", "t2")
    assert "Call the dentist" in speech


def test_completing_a_repeating_task_says_it_moved() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(
            hass, "TaskTickCompleteTask", {"title": _slot("Buy milk")}
        )
        return _speech(response)

    speech = _with_client(body, recurred=True)
    # Saying "complete" for a task that rolled forward sends the user looking for
    # something that is still on their list.
    assert "repeats" in speech
    assert "complete" not in speech.lower()


def test_delete_task() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(hass, "TaskTickDeleteTask", {"title": _slot("Buy milk")})
        return _speech(response), client.calls

    speech, calls = _with_client(body)
    assert calls[0] == ("delete_task", "t1")
    assert "Buy milk" in speech


def test_unknown_task_reports_the_title() -> None:
    async def body(hass, client, refreshes):
        with pytest.raises(intent.IntentHandleError) as caught:
            await _handle(hass, "TaskTickCompleteTask", {"title": _slot("walk the dog")})
        return str(caught.value)

    message = _with_client(body)
    assert "walk the dog" in message


# -- habits ---------------------------------------------------------------- #


def test_check_in_sends_a_delta() -> None:
    async def body(hass, client, refreshes):
        await _handle(hass, "TaskTickCheckInHabit", {"habit": _slot("go for a run")})
        return client.calls

    calls = _with_client(body)
    # `delta`, not an absolute count: correct for a count habit, which should
    # accumulate rather than be reset to whatever we assumed.
    assert calls[0] == ("check_in_habit", "h1", {"delta": 1})


def test_check_in_that_meets_the_target() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(hass, "TaskTickCheckInHabit", {"habit": _slot("go for a run")})
        return _speech(response)

    assert "done" in _with_client(body).lower()


def test_check_in_that_does_not_meet_the_target_reports_progress() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(hass, "TaskTickCheckInHabit", {"habit": _slot("go for a run")})
        return _speech(response)

    speech = _with_client(body, done_today=False, progress=0.25)
    assert "25" in speech


def test_habit_status_for_one_habit() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(hass, "TaskTickHabitStatus", {"habit": _slot("go for a run")})
        return _speech(response)

    speech = _with_client(body)
    assert "Go for a run" in speech
    assert "4 day streak" in speech
    assert "Read" not in speech


def test_habit_status_for_all_habits() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(hass, "TaskTickHabitStatus", {})
        return _speech(response)

    speech = _with_client(body)
    assert "Go for a run" in speech and "Read" in speech


def test_unknown_habit_reports_the_name() -> None:
    async def body(hass, client, refreshes):
        with pytest.raises(intent.IntentHandleError) as caught:
            await _handle(hass, "TaskTickCheckInHabit", {"habit": _slot("meditate")})
        return str(caught.value)

    assert "meditate" in _with_client(body)


# -- events ---------------------------------------------------------------- #


def test_create_event_defaults_to_the_default_calendar() -> None:
    async def body(hass, client, refreshes):
        response = await _handle(
            hass,
            "TaskTickCreateEvent",
            {"title": _slot("dentist"), "time": _slot("9am")},
        )
        return _speech(response), client.calls

    speech, calls = _with_client(body)
    payload = calls[0][1]
    assert payload["calendarId"] == "c1"
    assert payload["summary"] == "dentist"
    # One hour when nothing says otherwise.
    assert payload["endMs"] - payload["startMs"] == 60 * 60 * 1000
    assert "9:00" in speech


def test_create_event_honours_a_duration_and_calendar() -> None:
    async def body(hass, client, refreshes):
        await _handle(
            hass,
            "TaskTickCreateEvent",
            {
                "title": _slot("standup"),
                "calendar": _slot("Personal"),
                "time": _slot("09:30"),
                "minutes": {"value": 15.0, "text": "15"},
            },
        )
        return client.calls

    payload = _with_client(body)[0][1]
    assert payload["endMs"] - payload["startMs"] == 15 * 60 * 1000


def test_create_event_refuses_a_read_only_calendar() -> None:
    async def body(hass, client, refreshes):
        with pytest.raises(intent.IntentHandleError) as caught:
            await _handle(
                hass,
                "TaskTickCreateEvent",
                {"title": _slot("dentist"), "calendar": _slot("Holidays"), "time": _slot("9am")},
            )
        return str(caught.value)

    assert "read-only" in _with_client(body)


def test_create_event_refuses_a_time_it_cannot_read() -> None:
    async def body(hass, client, refreshes):
        with pytest.raises(intent.IntentHandleError) as caught:
            await _handle(
                hass,
                "TaskTickCreateEvent",
                {"title": _slot("dentist"), "time": _slot("sometime")},
            )
        return str(caught.value)

    assert "sometime" in _with_client(body)


def test_create_event_without_a_time_is_all_day() -> None:
    """A day on its own is a complete request: a birthday has no hour."""

    async def body(hass, client, refreshes):
        response = await _handle(
            hass,
            "TaskTickCreateEvent",
            {"title": _slot("Kyle's birthday"), "day": _slot("today")},
        )
        return _speech(response), client.calls

    speech, calls = _with_client(body)
    payload = calls[0][1]
    today = dt_util.now().date().isoformat()
    assert payload == {
        "calendarId": "c1",
        "summary": "Kyle's birthday",
        "startDate": today,
        "endDate": today,
        # No timestamps at all: the server reads an all-day event from the dates,
        # and sending midnight would put it at the top of the day instead.
        "isAllDay": True,
    }
    assert "all day" in speech


def test_create_event_understands_a_weekday() -> None:
    """A model says "friday", not "2026-03-06": the day slot has to translate.

    The tool schema hands the model a free string, so before this the only legal
    values were today and tomorrow and anything else came back as "I did not
    understand the day friday" — which reads to the user as the assistant being
    unable to add events at all.
    """

    async def body(hass, client, refreshes):
        response = await _handle(
            hass,
            "TaskTickCreateEvent",
            {"title": _slot("Haircut"), "day": _slot("friday"), "time": _slot("3pm")},
        )
        return _speech(response), client.calls

    speech, calls = _with_client(body)
    name, payload = calls[0]
    assert name == "create_event"

    today = dt_util.now().date()
    friday = today + timedelta(days=(4 - today.weekday()) % 7)
    start = dt_util.as_local(
        dt_util.start_of_local_day(friday) + timedelta(hours=15)
    )
    assert payload["calendarId"] == "c1"
    assert payload["summary"] == "Haircut"
    assert payload["startMs"] == pytest.approx(start.timestamp() * 1000)
    assert payload["endMs"] == pytest.approx(start.timestamp() * 1000 + 3_600_000)
    assert "Friday" in speech


def test_create_event_reads_a_full_date() -> None:
    """An ISO date is the other shape a model produces, so it is accepted too."""

    async def body(hass, client, refreshes):
        await _handle(
            hass,
            "TaskTickCreateEvent",
            {"title": _slot("Dentist"), "day": _slot("2026-10-25")},
        )
        return client.calls

    calls = _with_client(body)
    assert calls[0][1]["startDate"] == "2026-10-25"
    assert calls[0][1]["isAllDay"] is True


def test_the_calendar_tool_describes_the_day_slot_to_the_model() -> None:
    """What the model reads is the description, so it has to name real forms.

    `IntentTool` publishes `handler.description` and the slot markers' own
    descriptions as the tool schema. "Execute Home Assistant TaskTickCreateEvent
    intent" is what the model saw before this, and a model that cannot tell a
    tool adds events answers that it can only read them.
    """

    handler = intents_module.TaskTickCreateEventIntent()
    assert "calendar" in (handler.description or "").lower()
    assert "friday" in (handler.description or "")
    assert "all-day" in (handler.description or "")

    keys = {str(key): key for key in handler.slot_schema}
    day = keys["day"]
    assert day.description and "friday" in day.description
    time_key = keys["time"]
    assert time_key.description and "3pm" in time_key.description


def test_create_event_uses_the_calendar_chosen_in_the_options() -> None:
    """The option decides, ahead of TaskTick's own default marker."""

    async def body(hass, client, refreshes):
        await _handle(
            hass,
            "TaskTickCreateEvent",
            {"title": _slot("standup"), "time": _slot("9:30am")},
        )
        return client.calls

    calls = _with_client(body, options={"default_calendar": "c3"})
    assert calls[0][1]["calendarId"] == "c3"


def test_create_event_falls_back_past_a_read_only_option() -> None:
    """A calendar that became a read-only subscription is not a destination."""

    async def body(hass, client, refreshes):
        await _handle(
            hass,
            "TaskTickCreateEvent",
            {"title": _slot("dentist"), "time": _slot("9am")},
        )
        return client.calls

    calls = _with_client(body, options={"default_calendar": "c2"})
    assert calls[0][1]["calendarId"] == "c1"


def test_every_registered_intent_is_handled() -> None:
    """The registration list and the handlers must not drift."""

    async def body(hass, client, refreshes):
        registered = {
            handler.intent_type for handler in intent.async_get(hass) if handler.intent_type.startswith("TaskTick")
        }
        return registered

    registered = _with_client(body)
    assert registered == set(intents_module.INTENT_TYPES)


def _llm_context():
    from homeassistant.helpers import llm  # noqa: PLC0415

    # `user_prompt` became optional after 2025.1, so filter against the installed
    # signature rather than pinning one release's keyword set.
    fields = {
        "platform": "conversation",
        "context": None,
        "language": "en",
        "assistant": None,
        "device_id": None,
        "user_prompt": "",
    }
    accepted = inspect.signature(llm.LLMContext.__init__).parameters
    return llm.LLMContext(**{key: value for key, value in fields.items() if key in accepted})


def test_intents_are_exposed_to_assist_as_tools() -> None:
    """Assist with an LLM calls tools, and it builds them from the registered intents.

    There is no per-integration tool list to maintain and no `llm.py` platform:
    `AssistAPI._async_get_tools` turns every registered intent into an
    `IntentTool`. Registering the handlers *is* the voice-assistant support, which
    is why this test lives beside the handler tests rather than in its own file.
    """

    async def body(hass, client, refreshes):
        from homeassistant.helpers import llm  # noqa: PLC0415

        api = llm.AssistAPI(hass)
        instance = await api.async_get_api_instance(_llm_context())
        return {tool.name for tool in instance.tools}

    names = _with_client(body)
    missing = set(intents_module.INTENT_TYPES) - names
    assert not missing, f"registered intents Assist cannot call: {sorted(missing)}"


def test_calling_a_tool_through_assist_writes() -> None:
    """A tool the model can see must reach the TaskTick API when it is called."""

    async def body(hass, client, refreshes):
        from homeassistant.helpers import llm  # noqa: PLC0415

        api = llm.AssistAPI(hass)
        instance = await api.async_get_api_instance(_llm_context())
        answer = await instance.async_call_tool(
            llm.ToolInput(tool_name="TaskTickAddTask", tool_args={"title": "buy bread"})
        )
        return answer, client.calls

    answer, calls = _with_client(body)
    assert calls and calls[0][0] == "create_task", "the tool did not reach the client"
    assert calls[0][1] == {"title": "buy bread"}
    assert answer, "the tool returned nothing for the model to speak"
