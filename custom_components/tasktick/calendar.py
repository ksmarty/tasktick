"""Calendar platform — one entity per TaskTick calendar, including CalDAV feeds.

The server expands recurrence (`getCalendarItems`) and this module never
re-derives it: a repeating event arrives as one ``CalendarItem`` per occurrence,
already resolved against the requested window. That is the project's rule for
every client, and a Home Assistant integration is just another client.

``async_get_events`` queries on demand with the window the calendar card asks
for, so scrolling a year ahead is one request rather than a cached year. The
``event`` property — the "next event" line on the card — cannot await, so it
reads a short upcoming window the coordinator keeps warm.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
import logging
from typing import Any

from homeassistant.components.calendar import (
    CalendarEntity,
    CalendarEntityFeature,
    CalendarEvent,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import DOMAIN, MANUFACTURER
from .coordinator import TaskTickCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: TaskTickCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        TaskTickCalendar(coordinator, entry, calendar["id"])
        for calendar in coordinator.data.calendars
    )


def to_ha_event(item: dict[str, Any]) -> CalendarEvent:
    """Map a TaskTick ``CalendarItem`` onto Home Assistant's calendar event."""
    all_day = bool(item.get("isAllDay"))
    start_ms = float(item["startMs"])
    end_ms = float(item["endMs"])

    if all_day:
        # The server sends all-day bounds as instants, but an all-day event is a
        # floating day: converting to a local date keeps it on the day the user
        # sees rather than the day UTC happens to be in.
        start: date | datetime = dt_util.as_local(dt_util.utc_from_timestamp(start_ms / 1000)).date()
        end: date | datetime = dt_util.as_local(dt_util.utc_from_timestamp(end_ms / 1000)).date()
    else:
        start = dt_util.as_local(dt_util.utc_from_timestamp(start_ms / 1000))
        end = dt_util.as_local(dt_util.utc_from_timestamp(end_ms / 1000))

    return CalendarEvent(
        start=start,
        end=end,
        summary=item.get("title") or "",
        description=None,
        location=item.get("location") or None,
        uid=item.get("id"),
    )


def to_event_input(kwargs: dict[str, Any]) -> dict[str, Any]:
    """Map Home Assistant's create/update keywords onto TaskTick's event input.

    Home Assistant passes ``dtstart``/``dtend`` as either a ``date`` or an aware
    ``datetime``; TaskTick wants ``startDate``/``endDate`` for the first and
    ``startMs``/``endMs`` for the second. Mixing them shifts an all-day event.
    """
    payload: dict[str, Any] = {}
    start = kwargs.get("dtstart")
    end = kwargs.get("dtend")

    if isinstance(start, datetime):
        payload["startMs"] = start.timestamp() * 1000
        if isinstance(end, datetime):
            payload["endMs"] = end.timestamp() * 1000
        else:
            payload["endMs"] = start.timestamp() * 1000 + 3_600_000
    elif isinstance(start, date):
        payload["startDate"] = start.isoformat()
        payload["endDate"] = (end if isinstance(end, date) else start).isoformat()
        payload["isAllDay"] = True

    if summary := kwargs.get("summary"):
        payload["summary"] = summary
    if (description := kwargs.get("description")) is not None:
        payload["description"] = description
    if location := kwargs.get("location"):
        payload["location"] = location
    return payload


class TaskTickCalendar(CoordinatorEntity[TaskTickCoordinator], CalendarEntity):
    """A TaskTick calendar."""

    _attr_has_entity_name = True
    _attr_supported_features = (
        CalendarEntityFeature.CREATE_EVENT
        | CalendarEntityFeature.UPDATE_EVENT
        | CalendarEntityFeature.DELETE_EVENT
    )

    def __init__(self, coordinator: TaskTickCoordinator, entry: ConfigEntry, calendar_id: str) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._calendar_id = calendar_id
        self._attr_unique_id = f"{entry.entry_id}_{calendar_id}"

    @property
    def _calendar(self) -> dict[str, Any] | None:
        return self.coordinator.data.calendar_by_id(self._calendar_id)

    @property
    def name(self) -> str | None:
        calendar = self._calendar
        return calendar["name"] if calendar else None

    @property
    def available(self) -> bool:
        return super().available and self._calendar is not None

    @property
    def device_info(self) -> DeviceInfo:
        calendar = self._calendar or {}
        provider = calendar.get("provider") or "local"
        return DeviceInfo(
            identifiers={(DOMAIN, f"{self._entry.entry_id}_{self._calendar_id}")},
            name=self.name or "TaskTick calendar",
            manufacturer=MANUFACTURER,
            model=f"{provider} calendar",
        )

    @property
    def event(self) -> CalendarEvent | None:
        """The next upcoming event, from the window the coordinator keeps warm."""
        now_ms = dt_util.utcnow().timestamp() * 1000
        upcoming = [
            item
            for item in self.coordinator.data.upcoming
            if item.get("calendarId") == self._calendar_id and float(item["endMs"]) >= now_ms
        ]
        if not upcoming:
            return None
        return to_ha_event(min(upcoming, key=lambda item: float(item["startMs"])))

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        items = await self.coordinator.client.async_calendar_items(
            start_date.timestamp() * 1000,
            end_date.timestamp() * 1000,
            [self._calendar_id],
        )
        return [to_ha_event(item) for item in items]

    # -- writes ----------------------------------------------------------- #

    async def async_create_event(self, **kwargs: Any) -> None:
        payload = to_event_input(kwargs)
        payload["calendarId"] = self._calendar_id
        if not payload.get("summary"):
            raise ValueError("an event needs a summary")
        await self.coordinator.client.async_create_event(payload)
        await self.coordinator.async_request_refresh()

    async def async_update_event(
        self,
        uid: str,
        event: dict[str, Any],
        recurrence_id: str | None = None,
        recurrence_range: str | None = None,
    ) -> None:
        # `event` is already a flat mapping of the same keys `async_create_event`
        # receives, so one mapper serves both.
        payload = to_event_input(event)
        if not payload:
            return
        await self.coordinator.client.async_update_event(uid, payload)
        await self.coordinator.async_request_refresh()

    async def async_delete_event(
        self,
        uid: str,
        recurrence_id: str | None = None,
        recurrence_range: str | None = None,
    ) -> None:
        await self.coordinator.client.async_delete_event(uid)
        await self.coordinator.async_request_refresh()
