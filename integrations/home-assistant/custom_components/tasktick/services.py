"""Services, so a TaskTick action can be automated from YAML.

Every service accepts **either an id or a name** for a list, calendar or habit.
Ids are stable and names are what a person writes in an automation; refusing one
of them makes the service annoying to use, and accepting both costs one lookup.

These are registered once and unregistered when the last entry unloads, because a
service with no loaded instance has nothing to act on.
"""

from __future__ import annotations

from datetime import date, datetime
import logging
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .coordinator import TaskTickCoordinator, get_coordinator
from .sentences import DEFAULT_LANGUAGE, async_install_sentences

_LOGGER = logging.getLogger(__name__)

SERVICE_CREATE_TASK = "create_task"
SERVICE_UPDATE_TASK = "update_task"
SERVICE_COMPLETE_TASK = "complete_task"
SERVICE_DELETE_TASK = "delete_task"
SERVICE_CHECK_IN_HABIT = "check_in_habit"
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
            calendar_id = next(
                (item["id"] for item in coordinator.data.calendars if item.get("isDefault")),
                None,
            )
        if calendar_id is None:
            raise ServiceValidationError("no calendar given, and none is marked default")
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
        DOMAIN, SERVICE_INSTALL_SENTENCES, handle_install_sentences,
        schema=INSTALL_SENTENCES_SCHEMA, supports_response=SupportsResponse.ALWAYS,
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
        SERVICE_INSTALL_SENTENCES,
    ):
        hass.services.async_remove(DOMAIN, service)
