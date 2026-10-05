"""GraphQL client for a TaskTick instance.

TaskTick's GraphQL API is the right surface for this integration rather than its
REST routes: the schema is self-describing, one query can fetch everything the
coordinator needs, and — the reason that matters most — **recurrence is expanded
server-side**. A client that re-derived date maths would disagree with the app.

Stdlib plus ``aiohttp`` only, so the URL handling can be tested without Home
Assistant.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp

from .const import DEFAULT_GRAPHQL_PATH

_LOGGER = logging.getLogger(__name__)

REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30)


class TaskTickError(Exception):
    """Base class. Anything raised out of this module is one of these."""


class TaskTickAuthError(TaskTickError):
    """The token was rejected, or is missing.

    Separate from the base class because it is the one failure the user can fix
    from Home Assistant, so the config entry is reauth-able rather than retried
    forever against a token that will never work.
    """


class TaskTickConnectionError(TaskTickError):
    """The instance could not be reached."""


def normalize_url(raw: str) -> str:
    """Turn whatever the user pasted into a GraphQL endpoint.

    People paste all four of these, and every one of them is a reasonable thing
    to have in the address bar:

        tasks.example.com
        https://tasks.example.com
        https://tasks.example.com/
        https://tasks.example.com/some/path

    A bare host gets ``https://`` because that is what a self-hosted instance
    behind a proxy serves, and guessing ``http://`` would send a token in
    cleartext. An explicit scheme is always honoured — a LAN instance on plain
    HTTP is a real setup and not one to "correct".

    Pure, so the accepted forms are pinned by a test rather than by a docstring.
    """
    candidate = raw.strip()
    if not candidate:
        raise ValueError("a URL is required")

    if "://" not in candidate:
        candidate = f"https://{candidate}"

    parts = urlsplit(candidate)
    if not parts.netloc:
        raise ValueError(f"{raw!r} is not a URL")

    path = parts.path.rstrip("/")
    if not path:
        path = DEFAULT_GRAPHQL_PATH
    elif not path.endswith(DEFAULT_GRAPHQL_PATH):
        path = f"{path}{DEFAULT_GRAPHQL_PATH}"

    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def origin_of(url: str) -> str:
    """The scheme and host of a normalised endpoint, for display."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


# --------------------------------------------------------------------------- #
# Documents
#
# One snapshot rather than a query per platform: the coordinator polls every
# minute and a TaskTick instance answers all of this from a handful of indexed
# rows, so N requests would be N times the latency for no benefit.
# --------------------------------------------------------------------------- #

SNAPSHOT_QUERY = """
query Snapshot {
  me { id name email timezone }
  settings { timezone timeFormat weekStartsOn }
  lists(includeArchived: false) {
    id name emoji color isInbox sortOrder taskCount openTaskCount
  }
  tags { id name color }
  tasks(filter: { statuses: [todo] }, sort: smart) {
    id title notes url status priority
    dueAtMs dueDate isAllDay startAtMs startDate
    listId calendarId tagIds isPinned estimateMinutes
    subtasks { id title status }
  }
  habits(includeArchived: false) {
    id name description icon color
    goalType goalTarget unit frequency weekDays timesPerPeriod
    startDate reminders streak longestStreak completionRate doneToday progress
  }
  calendars { id name color isVisible provider readOnly isDefault }
  stats(days: 30) { completedByDay totalCompleted currentStreakDays }
}
"""

CALENDAR_ITEMS_QUERY = """
query Items($startMs: Float!, $endMs: Float!, $calendarIds: [ID!]) {
  calendarItems(startMs: $startMs, endMs: $endMs, calendarIds: $calendarIds, kinds: [event]) {
    items {
      key kind id title startMs endMs isAllDay
      color calendarId calendarName location url readonly
    }
  }
}
"""

CREATE_TASK_MUTATION = """
mutation Create($input: CreateTaskInput!) {
  createTask(input: $input) { id title }
}
"""

UPDATE_TASK_MUTATION = """
mutation Update($id: ID!, $input: UpdateTaskInput!) {
  updateTask(id: $id, input: $input) { id title status }
}
"""

COMPLETE_TASK_MUTATION = """
mutation Complete($id: ID!) {
  completeTask(id: $id) { recurred task { id status } }
}
"""

UNCOMPLETE_TASK_MUTATION = """
mutation Uncomplete($id: ID!) {
  uncompleteTask(id: $id) { task { id status } }
}
"""

DELETE_TASK_MUTATION = """
mutation Delete($id: ID!) { deleteTask(id: $id) { deleted } }
"""

CHECK_IN_HABIT_MUTATION = """
mutation CheckIn($id: ID!, $input: CheckInInput) {
  checkInHabit(id: $id, input: $input) { doneToday habit { id doneToday progress streak } }
}
"""

CREATE_EVENT_MUTATION = """
mutation CreateEvent($input: CreateEventInput!) {
  createEvent(input: $input) { id summary startMs endMs }
}
"""

UPDATE_EVENT_MUTATION = """
mutation UpdateEvent($id: ID!, $input: UpdateEventInput!) {
  updateEvent(id: $id, input: $input) { id summary startMs endMs }
}
"""

DELETE_EVENT_MUTATION = """
mutation DeleteEvent($id: ID!) { deleteEvent(id: $id) { deleted } }
"""


class TaskTickClient:
    """A thin, typed wrapper over one instance's GraphQL endpoint."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        url: str,
        token: str,
        verify_ssl: bool = True,
    ) -> None:
        self._session = session
        self.url = normalize_url(url)
        self._token = token
        self._verify_ssl = verify_ssl

    @property
    def origin(self) -> str:
        return origin_of(self.url)

    async def _execute(self, document: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"query": document}
        if variables:
            payload["variables"] = variables

        try:
            response = await self._session.post(
                self.url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                timeout=REQUEST_TIMEOUT,
                ssl=self._verify_ssl or None,
            )
        except aiohttp.ClientError as err:
            raise TaskTickConnectionError(str(err)) from err
        except asyncio.TimeoutError as err:
            raise TaskTickConnectionError("timed out talking to TaskTick") from err

        if response.status in (401, 403):
            raise TaskTickAuthError(f"TaskTick rejected the API token ({response.status})")

        if response.status >= 400:
            raise TaskTickError(f"TaskTick answered HTTP {response.status}")

        try:
            body = await response.json(content_type=None)
        except ValueError as err:
            # A proxy login page, or an HTML error page. Saying so beats a
            # JSONDecodeError the user cannot act on.
            raise TaskTickError("TaskTick did not answer with JSON — check the URL points at the instance") from err

        if errors := body.get("errors"):
            message = "; ".join(str(item.get("message", item)) for item in errors)
            raise TaskTickError(f"TaskTick rejected the query: {message}")

        data = body.get("data")
        if not isinstance(data, dict):
            raise TaskTickError("TaskTick answered without data")
        return data

    async def async_validate(self) -> dict[str, Any]:
        """Fetch the account, which is also the cheapest way to prove the token."""
        return (await self._execute("query Me { me { id name email timezone } }"))["me"]

    async def async_snapshot(self) -> dict[str, Any]:
        return await self._execute(SNAPSHOT_QUERY)

    async def async_calendar_items(
        self, start_ms: float, end_ms: float, calendar_ids: list[str] | None = None
    ) -> list[dict[str, Any]]:
        data = await self._execute(
            CALENDAR_ITEMS_QUERY,
            {"startMs": start_ms, "endMs": end_ms, "calendarIds": calendar_ids},
        )
        return data["calendarItems"]["items"]

    async def async_create_task(self, task_input: dict[str, Any]) -> dict[str, Any]:
        return (await self._execute(CREATE_TASK_MUTATION, {"input": task_input}))["createTask"]

    async def async_update_task(self, task_id: str, task_input: dict[str, Any]) -> dict[str, Any]:
        return (await self._execute(UPDATE_TASK_MUTATION, {"id": task_id, "input": task_input}))["updateTask"]

    async def async_complete_task(self, task_id: str) -> dict[str, Any]:
        return (await self._execute(COMPLETE_TASK_MUTATION, {"id": task_id}))["completeTask"]

    async def async_uncomplete_task(self, task_id: str) -> dict[str, Any]:
        return (await self._execute(UNCOMPLETE_TASK_MUTATION, {"id": task_id}))["uncompleteTask"]

    async def async_delete_task(self, task_id: str) -> None:
        await self._execute(DELETE_TASK_MUTATION, {"id": task_id})

    async def async_check_in_habit(self, habit_id: str, check_in: dict[str, Any] | None = None) -> dict[str, Any]:
        return (await self._execute(CHECK_IN_HABIT_MUTATION, {"id": habit_id, "input": check_in}))["checkInHabit"]

    async def async_create_event(self, event_input: dict[str, Any]) -> dict[str, Any]:
        return (await self._execute(CREATE_EVENT_MUTATION, {"input": event_input}))["createEvent"]

    async def async_update_event(self, event_id: str, event_input: dict[str, Any]) -> dict[str, Any]:
        return (await self._execute(UPDATE_EVENT_MUTATION, {"id": event_id, "input": event_input}))["updateEvent"]

    async def async_delete_event(self, event_id: str) -> None:
        await self._execute(DELETE_EVENT_MUTATION, {"id": event_id})
