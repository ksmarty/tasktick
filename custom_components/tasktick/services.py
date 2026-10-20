"""Services, so a TaskTick action can be automated from YAML.

Every service accepts **either an id or a name** for a list, calendar or habit.
Ids are stable and names are what a person writes in an automation; refusing one
of them makes the service annoying to use, and accepting both costs one lookup.

These are registered once and unregistered when the last entry unloads, because a
service with no loaded instance has nothing to act on.
"""

from __future__ import annotations

from datetime import date, datetime
from datetime import time as dtime
import logging
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from .const import CONF_DEFAULT_CALENDAR, DOMAIN
from .coordinator import TaskTickCoordinator, TaskTickData, get_coordinator
from .reminders import (
    REMINDERS_CREATE,
    REMINDERS_DOMAIN,
    pick_target,
    reminder_payload,
    schedule_fields,
    validate_trigger,
)
from .sentences import DEFAULT_LANGUAGE, async_install_sentences
from .util import default_calendar_id

_LOGGER = logging.getLogger(__name__)

SERVICE_CREATE_TASK = "create_task"
SERVICE_UPDATE_TASK = "update_task"
SERVICE_COMPLETE_TASK = "complete_task"
SERVICE_DELETE_TASK = "delete_task"
SERVICE_CHECK_IN_HABIT = "check_in_habit"
SERVICE_CREATE_REMINDER = "create_reminder"
SERVICE_CREATE_EVENT = "create_event"
SERVICE_UPDATE_EVENT = "update_event"
SERVICE_DELETE_EVENT = "delete_event"
#: Assist sentence templates are only loaded from `<config>/custom_sentences/`,
#: so this copies them there. See sentences.py.
SERVICE_INSTALL_SENTENCES = "install_sentences"

ATTR_LANGUAGE = "language"

ATTR_TASK_ID = "task_id"
ATTR_TITLE = "title"
ATTR_NOTES = "notes"
ATTR_LIST = "list"
ATTR_DUE = "due"
ATTR_PRIORITY = "priority"
ATTR_TAGS = "tags"
ATTR_HABIT = "habit"
ATTR_COUNT = "count"
ATTR_DELTA = "delta"
ATTR_DATE = "date"
ATTR_CALENDAR = "calendar"
ATTR_SUMMARY = "summary"
ATTR_START = "start"
ATTR_END = "end"
ATTR_ALL_DAY = "all_day"
ATTR_DESCRIPTION = "description"
ATTR_LOCATION = "location"
ATTR_RRULE = "rrule"
ATTR_REMINDERS = "reminders"
ATTR_EVENT_ID = "event_id"

# --- create_reminder -------------------------------------------------------- #
# The reminder's own fields. `task_id`, `habit`, `event_id` and `date` are shared
# with the services above; the rest are named exactly as HA Reminders names them,
# because the values are handed over untouched.
ATTR_MESSAGE = "message"
ATTR_COMPLETE = "complete"
ATTR_ICON = "icon"
ATTR_NOTIFY_SERVICE = "notify_service"
ATTR_USER_NAME = "user_name"
ATTR_ACKNOWLEDGE_ACTION_TITLE = "acknowledge_action_title"
ATTR_TRIGGER_TYPE = "trigger_type"
ATTR_TIME = "time"
ATTR_START_DATE = "start_date"
ATTR_STOP_DATE = "stop_date"
ATTR_EVERY_X_DAYS = "every_x_days"
ATTR_EXCLUDE_DAYS_OF_WEEK = "exclude_days_of_week"
ATTR_ZONE_ENTITY_ID = "zone_entity_id"
ATTR_PERSON_ENTITY_IDS = "person_entity_ids"
ATTR_TIME_WINDOW_START = "time_window_start"
ATTR_TIME_WINDOW_END = "time_window_end"
ATTR_SNOOZE_DELAYS = "snooze_delays"
ATTR_SNOOZE_TEXT = "snooze_text"
ATTR_NOTIFICATION_GROUP = "notification_group"
ATTR_ENABLED = "enabled"
ATTR_ONE_SHOT = "one_shot"
ATTR_WAIT_TIME = "wait_time_if_no_action"
ATTR_NOTIFICATION_COUNT = "notification_count"

#: The three triggers HA Reminders understands, and the two that need a zone and
#: the people to watch for in it.
REMINDER_TRIGGERS = ("time", "zone_enter", "zone_leave")

CREATE_TASK_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_TITLE): vol.All(str, vol.Length(min=1)),
        vol.Optional(ATTR_LIST): str,
        vol.Optional(ATTR_NOTES): str,
        vol.Optional(ATTR_DUE): vol.Any(str, datetime, date),
        vol.Optional(ATTR_PRIORITY): vol.In(["none", "low", "medium", "high"]),
        vol.Optional(ATTR_TAGS): vol.All(vol.Any(str, [str]), vol.Coerce(list)),
        vol.Optional(ATTR_CALENDAR): str,
    }
)

UPDATE_TASK_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_TASK_ID): str,
        vol.Optional(ATTR_TITLE): vol.All(str, vol.Length(min=1)),
        vol.Optional(ATTR_LIST): str,
        vol.Optional(ATTR_NOTES): str,
        vol.Optional(ATTR_DUE): vol.Any(str, datetime, date, None),
        vol.Optional(ATTR_PRIORITY): vol.In(["none", "low", "medium", "high"]),
        vol.Optional(ATTR_TAGS): vol.All(vol.Any(str, [str]), vol.Coerce(list)),
        vol.Optional(ATTR_CALENDAR): str,
    }
)

TASK_ID_SCHEMA = vol.Schema({vol.Required(ATTR_TASK_ID): str})

CHECK_IN_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_HABIT): str,
        vol.Optional(ATTR_DATE): vol.Any(str, date),
        vol.Optional(ATTR_COUNT): vol.Coerce(float),
        vol.Optional(ATTR_DELTA): vol.Coerce(float),
    }
)

EVENT_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_CALENDAR): str,
        vol.Optional(ATTR_SUMMARY): vol.All(str, vol.Length(min=1)),
        vol.Optional(ATTR_START): vol.Any(str, datetime, date),
        vol.Optional(ATTR_END): vol.Any(str, datetime, date),
        vol.Optional(ATTR_ALL_DAY, default=False): bool,
        vol.Optional(ATTR_DESCRIPTION): str,
        vol.Optional(ATTR_LOCATION): str,
        vol.Optional(ATTR_RRULE): str,
        vol.Optional(ATTR_REMINDERS): vol.All(vol.Coerce(list), [vol.Coerce(int)]),
    }
)

UPDATE_EVENT_SCHEMA = EVENT_SCHEMA.extend({vol.Required(ATTR_EVENT_ID): str})

EVENT_ID_SCHEMA = vol.Schema({vol.Required(ATTR_EVENT_ID): str})

INSTALL_SENTENCES_SCHEMA = vol.Schema(
    {vol.Optional(ATTR_LANGUAGE, default=DEFAULT_LANGUAGE): str}
)

#: A day or a clock time, as either the string an automation wrote or the value a
#: Home Assistant selector produced.
_DAY = vol.Any(str, date)
_CLOCK = vol.Any(str, dtime)
_WEEKDAY = vol.All(vol.Coerce(int), vol.Range(min=0, max=6))
_DELAY = vol.All(vol.Coerce(int), vol.Range(min=1))

CREATE_REMINDER_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_TITLE): vol.All(str, vol.Length(min=1)),
        vol.Optional(ATTR_MESSAGE): str,
        # What the reminder is about, and the day it opens on. Exactly one of the
        # three, which the handler checks rather than the schema: a voluptuous
        # exclusive-or reads as a puzzle, and the error it raises names no field.
        vol.Optional(ATTR_TASK_ID): str,
        vol.Optional(ATTR_HABIT): str,
        vol.Optional(ATTR_EVENT_ID): str,
        vol.Optional(ATTR_DATE): _DAY,
        vol.Optional(ATTR_COMPLETE, default=True): bool,
        vol.Optional(ATTR_ICON): str,
        vol.Optional(ATTR_NOTIFY_SERVICE): str,
        vol.Optional(ATTR_USER_NAME): str,
        vol.Optional(ATTR_ACKNOWLEDGE_ACTION_TITLE): str,
        vol.Optional(ATTR_TRIGGER_TYPE, default="time"): vol.In(REMINDER_TRIGGERS),
        vol.Optional(ATTR_TIME): _CLOCK,
        vol.Optional(ATTR_START_DATE): _DAY,
        vol.Optional(ATTR_STOP_DATE): _DAY,
        vol.Optional(ATTR_EVERY_X_DAYS): _DELAY,
        vol.Optional(ATTR_EXCLUDE_DAYS_OF_WEEK): vol.Any(_WEEKDAY, [_WEEKDAY]),
        vol.Optional(ATTR_ZONE_ENTITY_ID): str,
        vol.Optional(ATTR_PERSON_ENTITY_IDS): vol.Any(str, [str]),
        vol.Optional(ATTR_TIME_WINDOW_START): _CLOCK,
        vol.Optional(ATTR_TIME_WINDOW_END): _CLOCK,
        vol.Optional(ATTR_SNOOZE_DELAYS): vol.Any(_DELAY, [_DELAY]),
        vol.Optional(ATTR_SNOOZE_TEXT): str,
        vol.Optional(ATTR_NOTIFICATION_GROUP): str,
        vol.Optional(ATTR_ENABLED, default=True): bool,
        vol.Optional(ATTR_ONE_SHOT, default=True): bool,
        vol.Optional(ATTR_WAIT_TIME): _DELAY,
        vol.Optional(ATTR_NOTIFICATION_COUNT): _DELAY,
    }
)


def _resolve(coordinator: TaskTickCoordinator, value: str | None, kind: str) -> str | None:
    """Accept an id or a name for a list, calendar or habit.

    Case-insensitive on the name, because an automation written by hand will not
    match capitalisation, and ids are matched first so an id always wins over a
    list that happens to share its name.
    """
    if value is None:
        return None
    data = coordinator.data
    pool = {
        "list": data.lists,
        "calendar": data.calendars,
        "habit": data.habits,
    }[kind]
    for item in pool:
        if item["id"] == value:
            return value
    folded = value.casefold()
    for item in pool:
        if (item.get("name") or "").casefold() == folded:
            return item["id"]
    raise ServiceValidationError(f"no {kind} called {value!r}")


def _parse_due(value: Any) -> dict[str, Any]:
    """A due date as either a floating day or an instant."""
    if isinstance(value, datetime):
        return {"dueAtMs": value.timestamp() * 1000}
    if isinstance(value, date):
        return {"dueDate": value.isoformat()}
    parsed_date = dt_util.parse_date(value)
    if parsed_date is not None:
        return {"dueDate": parsed_date.isoformat()}
    parsed_datetime = dt_util.parse_datetime(value)
    if parsed_datetime is not None:
        return {"dueAtMs": parsed_datetime.timestamp() * 1000}
    raise ServiceValidationError(f"could not read {value!r} as a date")


def _parse_event_times(data: dict[str, Any]) -> dict[str, Any]:
    start = data.get(ATTR_START)
    end = data.get(ATTR_END)
    payload: dict[str, Any] = {}

    if start is None:
        return payload

    all_day = bool(data.get(ATTR_ALL_DAY))
    if isinstance(start, date) and not isinstance(start, datetime):
        all_day = True

    if all_day:
        start_date = start if isinstance(start, date) else dt_util.parse_date(str(start))
        if start_date is None:
            raise ServiceValidationError(f"could not read {start!r} as a day")
        payload["startDate"] = start_date.isoformat()
        end_date = end if isinstance(end, date) else (dt_util.parse_date(str(end)) if end else None)
        payload["endDate"] = (end_date or start_date).isoformat()
        payload["isAllDay"] = True
    else:
        start_dt = start if isinstance(start, datetime) else dt_util.parse_datetime(str(start))
        if start_dt is None:
            raise ServiceValidationError(f"could not read {start!r} as a time")
        payload["startMs"] = start_dt.timestamp() * 1000
        end_dt = end if isinstance(end, datetime) else (dt_util.parse_datetime(str(end)) if end else None)
        payload["endMs"] = (end_dt or start_dt).timestamp() * 1000

    return payload


def _reminder_record(
    data: TaskTickData, target: str, target_id: str
) -> dict[str, Any] | None:
    """The task or habit a reminder is about, so the reminder can borrow its name.

    An event is not in the snapshot — calendar items are expanded per window — so
    an event reminder is the one kind that has to be told its own title.
    """
    if target == "task":
        record = next((task for task in data.tasks if task["id"] == target_id), None)
        if record is None:
            raise ServiceValidationError(f"no open task with id {target_id!r}")
        return record
    if target == "habit":
        record = data.habit_by_id(target_id)
        if record is None:
            raise ServiceValidationError(f"no habit with id {target_id!r}")
        return record
    return None


def _reminder_title(record: dict[str, Any] | None, given: str | None) -> str:
    """The reminder's title: the one given, or the task's or habit's own words."""
    if given:
        return given
    if record is None:
        return ""
    return str(record.get("title") or record.get("name") or "")


def async_setup_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, SERVICE_CREATE_TASK):
        return

    async def handle_create_task(call: ServiceCall) -> dict[str, Any]:
        coordinator = get_coordinator(hass)
        payload: dict[str, Any] = {"title": call.data[ATTR_TITLE]}
        if list_id := _resolve(coordinator, call.data.get(ATTR_LIST), "list"):
            payload["listId"] = list_id
        if notes := call.data.get(ATTR_NOTES):
            payload["notes"] = notes
        if priority := call.data.get(ATTR_PRIORITY):
            payload["priority"] = priority
        if tags := call.data.get(ATTR_TAGS):
            payload["tagNames"] = tags
        if calendar_id := _resolve(coordinator, call.data.get(ATTR_CALENDAR), "calendar"):
            payload["calendarId"] = calendar_id
        if (due := call.data.get(ATTR_DUE)) is not None:
            payload.update(_parse_due(due))

        task = await coordinator.client.async_create_task(payload)
        await coordinator.async_request_refresh()
        return task

    async def handle_update_task(call: ServiceCall) -> None:
        coordinator = get_coordinator(hass)
        payload: dict[str, Any] = {}
        if (title := call.data.get(ATTR_TITLE)) is not None:
            payload["title"] = title
        if (notes := call.data.get(ATTR_NOTES)) is not None:
            payload["notes"] = notes
        if (priority := call.data.get(ATTR_PRIORITY)) is not None:
            payload["priority"] = priority
        if (tags := call.data.get(ATTR_TAGS)) is not None:
            payload["tagNames"] = tags
        if (list_name := call.data.get(ATTR_LIST)) is not None:
            payload["listId"] = _resolve(coordinator, list_name, "list")
        if (calendar_name := call.data.get(ATTR_CALENDAR)) is not None:
            payload["calendarId"] = _resolve(coordinator, calendar_name, "calendar")
        if ATTR_DUE in call.data:
            if call.data[ATTR_DUE] is None:
                payload["clearDue"] = True
            else:
                payload.update(_parse_due(call.data[ATTR_DUE]))

        if payload:
            await coordinator.client.async_update_task(call.data[ATTR_TASK_ID], payload)
            await coordinator.async_request_refresh()

    async def handle_complete_task(call: ServiceCall) -> None:
        coordinator = get_coordinator(hass)
        await coordinator.client.async_complete_task(call.data[ATTR_TASK_ID])
        await coordinator.async_request_refresh()

    async def handle_delete_task(call: ServiceCall) -> None:
        coordinator = get_coordinator(hass)
        await coordinator.client.async_delete_task(call.data[ATTR_TASK_ID])
        await coordinator.async_request_refresh()

    async def handle_check_in(call: ServiceCall) -> None:
        coordinator = get_coordinator(hass)
        habit_id = _resolve(coordinator, call.data[ATTR_HABIT], "habit")
        payload: dict[str, Any] = {}
        if (check_in_date := call.data.get(ATTR_DATE)) is not None:
            payload["date"] = (
                check_in_date.isoformat()
                if isinstance(check_in_date, date)
                else str(check_in_date)
            )
        if (count := call.data.get(ATTR_COUNT)) is not None:
            payload["count"] = count
        if (delta := call.data.get(ATTR_DELTA)) is not None:
            payload["delta"] = delta
        await coordinator.client.async_check_in_habit(habit_id, payload or None)
        await coordinator.async_request_refresh()

    async def handle_create_event(call: ServiceCall) -> dict[str, Any]:
        coordinator = get_coordinator(hass)
        calendar_id = _resolve(coordinator, call.data.get(ATTR_CALENDAR), "calendar")
        if calendar_id is None:
            # The same order the voice path uses, so a calendar chosen once in
            # the options is the answer for both.
            calendar_id = default_calendar_id(
                coordinator.data.calendars,
                coordinator.entry.options.get(CONF_DEFAULT_CALENDAR),
            )
        if calendar_id is None:
            raise ServiceValidationError("no calendar given, and no writable one to fall back on")
        summary = call.data.get(ATTR_SUMMARY)
        if not summary:
            raise ServiceValidationError("an event needs a summary")

        payload: dict[str, Any] = {"calendarId": calendar_id, "summary": summary}
        payload.update(_parse_event_times(call.data))
        for key, attr in (
            ("description", ATTR_DESCRIPTION),
            ("location", ATTR_LOCATION),
            ("rrule", ATTR_RRULE),
            ("reminders", ATTR_REMINDERS),
        ):
            if (value := call.data.get(attr)) is not None:
                payload[key] = value

        event = await coordinator.client.async_create_event(payload)
        await coordinator.async_request_refresh()
        return event

    async def handle_update_event(call: ServiceCall) -> None:
        coordinator = get_coordinator(hass)
        payload: dict[str, Any] = {}
        if (summary := call.data.get(ATTR_SUMMARY)) is not None:
            payload["summary"] = summary
        if (calendar_name := call.data.get(ATTR_CALENDAR)) is not None:
            payload["calendarId"] = _resolve(coordinator, calendar_name, "calendar")
        payload.update(_parse_event_times(call.data))
        for key, attr in (
            ("description", ATTR_DESCRIPTION),
            ("location", ATTR_LOCATION),
            ("rrule", ATTR_RRULE),
            ("reminders", ATTR_REMINDERS),
        ):
            if (value := call.data.get(attr)) is not None:
                payload[key] = value

        if payload:
            await coordinator.client.async_update_event(call.data[ATTR_EVENT_ID], payload)
            await coordinator.async_request_refresh()

    async def handle_delete_event(call: ServiceCall) -> None:
        coordinator = get_coordinator(hass)
        await coordinator.client.async_delete_event(call.data[ATTR_EVENT_ID])
        await coordinator.async_request_refresh()

    async def handle_create_reminder(call: ServiceCall) -> dict[str, Any]:
        coordinator = get_coordinator(hass)
        if not hass.services.has_service(REMINDERS_DOMAIN, REMINDERS_CREATE):
            raise ServiceValidationError(
                "HA Reminders is not installed, and it is what delivers these "
                "notifications"
            )

        try:
            target, target_id, day = pick_target(
                call.data,
                task=ATTR_TASK_ID,
                habit=ATTR_HABIT,
                event=ATTR_EVENT_ID,
                date_key=ATTR_DATE,
            )
        except ValueError as err:
            raise ServiceValidationError(str(err)) from err

        record = _reminder_record(coordinator.data, target, target_id)
        payload = {
            **schedule_fields(call.data),
            **reminder_payload(
                origin=coordinator.client.origin,
                target=target,
                target_id=target_id,
                day=day,
                title=_reminder_title(record, call.data.get(ATTR_TITLE)),
                message=call.data.get(ATTR_MESSAGE) or "",
                icon=call.data.get(ATTR_ICON) or "",
                notify_service=call.data.get(ATTR_NOTIFY_SERVICE) or "",
                user_name=call.data.get(ATTR_USER_NAME) or "",
                complete=call.data[ATTR_COMPLETE],
                acknowledge_title=call.data.get(ATTR_ACKNOWLEDGE_ACTION_TITLE) or "",
            ),
        }
        if not payload["title"]:
            raise ServiceValidationError(
                "a reminder needs a title, and one cannot be read from that target"
            )
        try:
            validate_trigger(payload)
        except ValueError as err:
            raise ServiceValidationError(str(err)) from err

        response = await hass.services.async_call(
            REMINDERS_DOMAIN,
            REMINDERS_CREATE,
            payload,
            blocking=True,
            return_response=True,
        )
        return response if isinstance(response, dict) else {}

    async def handle_install_sentences(call: ServiceCall) -> dict[str, Any]:
        return await async_install_sentences(
            hass, call.data.get(ATTR_LANGUAGE, DEFAULT_LANGUAGE)
        )

    hass.services.async_register(
        DOMAIN, SERVICE_CREATE_TASK, handle_create_task,
        schema=CREATE_TASK_SCHEMA, supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(DOMAIN, SERVICE_UPDATE_TASK, handle_update_task, schema=UPDATE_TASK_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_COMPLETE_TASK, handle_complete_task, schema=TASK_ID_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_DELETE_TASK, handle_delete_task, schema=TASK_ID_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_CHECK_IN_HABIT, handle_check_in, schema=CHECK_IN_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_CREATE_EVENT, handle_create_event,
        schema=EVENT_SCHEMA, supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(DOMAIN, SERVICE_UPDATE_EVENT, handle_update_event, schema=UPDATE_EVENT_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_DELETE_EVENT, handle_delete_event, schema=EVENT_ID_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_CREATE_REMINDER, handle_create_reminder,
        schema=CREATE_REMINDER_SCHEMA, supports_response=SupportsResponse.OPTIONAL,
    )
    # `OPTIONAL`, not `ONLY`: the handler does the work and also answers with a
    # summary, so a caller may read the result or ignore it. The enum offers
    # NONE, OPTIONAL and ONLY — there is no ALWAYS, and naming one that does not
    # exist raises AttributeError here, which fails the whole config entry.
    hass.services.async_register(
        DOMAIN, SERVICE_INSTALL_SENTENCES, handle_install_sentences,
        schema=INSTALL_SENTENCES_SCHEMA, supports_response=SupportsResponse.OPTIONAL,
    )


def async_unload_services(hass: HomeAssistant) -> None:
    for service in (
        SERVICE_CREATE_TASK,
        SERVICE_UPDATE_TASK,
        SERVICE_COMPLETE_TASK,
        SERVICE_DELETE_TASK,
        SERVICE_CHECK_IN_HABIT,
        SERVICE_CREATE_EVENT,
        SERVICE_UPDATE_EVENT,
        SERVICE_DELETE_EVENT,
        SERVICE_CREATE_REMINDER,
        SERVICE_INSTALL_SENTENCES,
    ):
        hass.services.async_remove(DOMAIN, service)
