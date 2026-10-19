"""Todo platform — one entity per TaskTick list.

This is the platform voice assist reaches: Assist's todo intents create, complete
and delete items through it, so the mutation path here is the one that has to be
right rather than merely present.

Two deliberate choices:

* **No optimistic local state.** The entity reports what the coordinator last
  saw. A completed item that marked itself done before the server agreed would be
  the integration inventing state, and a failure would leave the UI lying.
* **Only the changed fields are sent.** Home Assistant hands ``async_update_todo_item``
  a whole item, so updating a due date naively would also re-send the summary and
  description. Diffing against the coordinator's copy means a rename cannot
  clobber notes that were edited in the app a second earlier.
"""

from __future__ import annotations

from datetime import date, datetime
import logging
from typing import Any

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
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
        TaskTickTodoList(coordinator, entry, task_list["id"])
        for task_list in coordinator.data.lists
    )


def due_from_task(task: dict[str, Any]) -> date | datetime | None:
    """Turn a task's due fields into what the todo platform expects.

    TaskTick stores an all-day due date as a floating ``YYYY-MM-DD`` and a timed
    one as an epoch instant. Home Assistant wants a ``date`` for the first and a
    timezone-aware ``datetime`` for the second, so the two are not interchangeable
    and guessing would shift an all-day task across midnight.
    """
    if due_at := task.get("dueAtMs"):
        return dt_util.as_local(dt_util.utc_from_timestamp(float(due_at) / 1000))
    if due_date := task.get("dueDate"):
        try:
            return date.fromisoformat(due_date)
        except ValueError:
            _LOGGER.debug("task %s has an unparseable dueDate %r", task.get("id"), due_date)
    return None


def due_to_input(due: date | datetime | None) -> dict[str, Any]:
    """The inverse of :func:`due_from_task`.

    ``None`` is not expressed here — clearing a due date needs ``clearDue``, which
    only exists on the update input, so the caller adds it.
    """
    if isinstance(due, datetime):
        return {"dueAtMs": due.timestamp() * 1000}
    if isinstance(due, date):
        return {"dueDate": due.isoformat()}
    return {}


class TaskTickTodoList(CoordinatorEntity[TaskTickCoordinator], TodoListEntity):
    """A TaskTick list, as a Home Assistant todo list."""

    _attr_has_entity_name = True
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
        | TodoListEntityFeature.SET_DUE_DATE_ON_ITEM
        | TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM
    )

    def __init__(self, coordinator: TaskTickCoordinator, entry: ConfigEntry, list_id: str) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._list_id = list_id
        self._attr_unique_id = f"{entry.entry_id}_{list_id}"

    @property
    def _task_list(self) -> dict[str, Any] | None:
        return self.coordinator.data.list_by_id(self._list_id)

    @property
    def name(self) -> str | None:
        task_list = self._task_list
        return task_list["name"] if task_list else None

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, f"{self._entry.entry_id}_{self._list_id}")},
            name=self.name or "TaskTick list",
            manufacturer=MANUFACTURER,
            entry_type=None,
        )

    @property
    def todo_items(self) -> list[TodoItem]:
        return [
            TodoItem(
                uid=task["id"],
                summary=task.get("title") or "",
                status=TodoItemStatus.NEEDS_ACTION,
                due=due_from_task(task),
                description=task.get("notes") or None,
            )
            for task in self.coordinator.data.tasks_in_list(self._list_id)
        ]

    # -- writes ----------------------------------------------------------- #

    async def async_create_todo_item(self, item: TodoItem) -> None:
        payload: dict[str, Any] = {"title": item.summary, "listId": self._list_id}
        if item.description:
            payload["notes"] = item.description
        if item.due is not None:
            payload.update(due_to_input(item.due))
        if item.status == TodoItemStatus.COMPLETED:
            # TaskTick has no "created already done" input, so this is a create
            # followed by a complete — one extra round trip for a case Assist
            # never produces but the UI can.
            created = await self.coordinator.client.async_create_task(payload)
            await self.coordinator.client.async_complete_task(created["id"])
        else:
            await self.coordinator.client.async_create_task(payload)
        await self.coordinator.async_request_refresh()

    async def async_update_todo_item(self, item: TodoItem) -> None:
        current = next(
            (task for task in self.coordinator.data.tasks if task["id"] == item.uid), None
        )
        if current is None:
            _LOGGER.debug("ignoring update for unknown task %s", item.uid)
            return

        # Status first: completing a task and renaming it are different calls.
        if item.status == TodoItemStatus.COMPLETED:
            await self.coordinator.client.async_complete_task(item.uid)
        elif item.status == TodoItemStatus.NEEDS_ACTION and current.get("status") != "todo":
            await self.coordinator.client.async_uncomplete_task(item.uid)

        patch: dict[str, Any] = {}
        if item.summary != (current.get("title") or ""):
            patch["title"] = item.summary
        if (item.description or None) != (current.get("notes") or None):
            patch["notes"] = item.description or ""
        current_due = due_from_task(current)
        if item.due != current_due:
            if item.due is None:
                patch["clearDue"] = True
            else:
                patch.update(due_to_input(item.due))

        if patch:
            await self.coordinator.client.async_update_task(item.uid, patch)

        await self.coordinator.async_request_refresh()

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        for uid in uids:
            await self.coordinator.client.async_delete_task(uid)
        await self.coordinator.async_request_refresh()
