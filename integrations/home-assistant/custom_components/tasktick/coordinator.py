"""The single poll that feeds every TaskTick entity.

One request per interval, not one per platform. TaskTick answers the whole
snapshot from a handful of indexed rows, so splitting it into a query per
platform would multiply the latency for nothing.

There is deliberately **no optimistic write path** here. Home Assistant's
convention is that an entity reports what the coordinator last saw; a completed
todo that updated itself locally would be the integration inventing state. So a
mutation ends with ``async_request_refresh()`` and the next poll is the truth.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import TaskTickAuthError, TaskTickClient, TaskTickConnectionError, TaskTickError
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN, PRIORITY_ORDER, UPCOMING_DAYS

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class TaskTickData:
    """One snapshot of the account, with the lookups the entities need."""

    me: dict[str, Any] = field(default_factory=dict)
    settings: dict[str, Any] = field(default_factory=dict)
    lists: list[dict[str, Any]] = field(default_factory=list)
    tags: list[dict[str, Any]] = field(default_factory=list)
    tasks: list[dict[str, Any]] = field(default_factory=list)
    habits: list[dict[str, Any]] = field(default_factory=list)
    calendars: list[dict[str, Any]] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)
    #: A short window of already-expanded calendar items, kept warm because the
    #: calendar entity's `event` property is synchronous and cannot query.
    upcoming: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_snapshot(
        cls, snapshot: dict[str, Any], upcoming: list[dict[str, Any]] | None = None
    ) -> TaskTickData:
        return cls(
            me=snapshot.get("me") or {},
            settings=snapshot.get("settings") or {},
            lists=snapshot.get("lists") or [],
            tags=snapshot.get("tags") or [],
            tasks=snapshot.get("tasks") or [],
            habits=snapshot.get("habits") or [],
            calendars=snapshot.get("calendars") or [],
            stats=snapshot.get("stats") or {},
            upcoming=upcoming or [],
        )

    # -- lookups ---------------------------------------------------------- #

    def list_by_id(self, list_id: str) -> dict[str, Any] | None:
        return next((item for item in self.lists if item["id"] == list_id), None)

    def habit_by_id(self, habit_id: str) -> dict[str, Any] | None:
        return next((item for item in self.habits if item["id"] == habit_id), None)

    def calendar_by_id(self, calendar_id: str) -> dict[str, Any] | None:
        return next((item for item in self.calendars if item["id"] == calendar_id), None)

    def tags_by_id(self, tag_ids: list[str] | None) -> list[dict[str, Any]]:
        wanted = set(tag_ids or [])
        return [tag for tag in self.tags if tag["id"] in wanted]

    def tasks_in_list(self, list_id: str) -> list[dict[str, Any]]:
        """Open tasks in one list, in the order the TaskTick UI would show them.

        Priority first, then the due date, then the title. Sorting here rather
        than trusting the server's `sort: smart` keeps the todo list stable when
        the user picks a different sort in the app — the integration has its own
        opinion and should not shuffle because a setting moved.
        """
        items = [task for task in self.tasks if task.get("listId") == list_id]
        return sorted(
            items,
            key=lambda task: (
                PRIORITY_ORDER.get(task.get("priority") or "none", 3),
                task.get("dueAtMs") or task.get("startAtMs") or float("inf"),
                (task.get("title") or "").casefold(),
            ),
        )


class TaskTickCoordinator(DataUpdateCoordinator[TaskTickData]):
    """Polls one TaskTick account."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: TaskTickClient) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN} ({client.origin})",
            update_interval=DEFAULT_SCAN_INTERVAL,
            config_entry=entry,
        )
        self.client = client
        self.entry = entry

    async def _async_update_data(self) -> TaskTickData:
        try:
            snapshot = await self.client.async_snapshot()
        except TaskTickAuthError as err:
            # Raises the reauth flow rather than retrying a token that is never
            # going to be accepted.
            raise ConfigEntryAuthFailed(str(err)) from err
        except TaskTickConnectionError as err:
            raise UpdateFailed(f"cannot reach TaskTick: {err}") from err
        except TaskTickError as err:
            raise UpdateFailed(str(err)) from err

        data = TaskTickData.from_snapshot(snapshot, await self._async_upcoming())
        _LOGGER.debug(
            "tasktick snapshot: %s lists, %s open tasks, %s habits, %s calendars, %s upcoming",
            len(data.lists),
            len(data.tasks),
            len(data.habits),
            len(data.calendars),
            len(data.upcoming),
        )
        return data

    async def _async_upcoming(self) -> list[dict[str, Any]]:
        """The window the calendar entities' `event` property reads.

        An hour back so an event that started ten minutes ago still shows as
        current rather than vanishing; two weeks forward, which is far enough for
        a "next event" line and small enough to stay cheap. A failure here is not
        a failure of the poll — the todo lists and habits are still good — so it
        degrades to an empty window.
        """
        now = datetime.now(timezone.utc)
        try:
            return await self.client.async_calendar_items(
                (now - timedelta(hours=1)).timestamp() * 1000,
                (now + timedelta(days=UPCOMING_DAYS)).timestamp() * 1000,
            )
        except TaskTickError as err:
            _LOGGER.debug("could not fetch the upcoming window: %s", err)
            return []


def get_coordinator(hass: HomeAssistant, *, allow_multiple: bool = False) -> TaskTickCoordinator:
    """The configured coordinator, shared by services, intents and LLM tools.

    A service acts on exactly one instance and says so when there are several.
    Voice does not: an Assist sentence has no way to name an instance, and every
    entity a person can actually say is unambiguous, so `allow_multiple=True`
    takes the first rather than refusing to do anything.
    """
    entries = hass.data.get(DOMAIN) or {}
    if not entries:
        raise HomeAssistantError("no TaskTick instance is configured")
    if len(entries) > 1 and not allow_multiple:
        raise HomeAssistantError(
            "more than one TaskTick instance is configured; this acts on a single one"
        )
    return next(iter(entries.values()))
