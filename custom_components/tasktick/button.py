"""Buttons: mark a habit done for the day, and take that back.

Two buttons rather than one "check in", because a single button can only ever
add. A boolean habit's target is 1, so a second press changes nothing, but a
count habit's +1 leaves no way back to "not done" from a dashboard or a wall
panel — and the habit screen in TaskTick offers both directions.

The pair mirrors what the app itself writes. "Mark as completed" sends the
day's target as an *absolute* count (1 for a boolean habit, the goal target for
a count habit, the goal target as the tracked value for a duration habit), so
pressing it twice is harmless and it reaches the target from any starting
point. "Mark as incomplete" clears the day's entry, which is what the app does
when the count is null or 0.

The first button keeps the `_check_in` unique id it had when it was the only
one, on purpose: Home Assistant finds an entity by unique id, so an existing
installation updates the button it already has — same entity id, same recorder
history — instead of gaining a third button beside an orphan.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MANUFACTURER
from .coordinator import TaskTickCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: TaskTickCoordinator = hass.data[DOMAIN][entry.entry_id]
    entities: list[ButtonEntity] = []
    for habit in coordinator.data.habits:
        entities.append(TaskTickHabitCompleteButton(coordinator, entry, habit["id"]))
        entities.append(TaskTickHabitIncompleteButton(coordinator, entry, habit["id"]))
    async_add_entities(entities)


def completion_check_in(habit: dict[str, Any]) -> dict[str, float]:
    """The check-in that meets a habit's target for the day.

    Absolute rather than a delta, so it is safe to press more than once and it
    lands on the target whatever the day already held. The two measurable goal
    types count different fields: a count habit sums `count`, a duration habit
    sums the tracked `value`, and both compare the sum against `goalTarget`.
    """
    goal = str(habit.get("goalType") or "boolean").lower()
    target = habit.get("goalTarget")
    if goal in ("count", "duration") and target:
        return {"count": float(target)} if goal == "count" else {"value": float(target)}
    return {"count": 1.0}


#: What "not done" writes: TaskTick deletes the day's entry for a count of 0.
INCOMPLETE_CHECK_IN: dict[str, float] = {"count": 0.0}


class TaskTickHabitButton(CoordinatorEntity[TaskTickCoordinator], ButtonEntity):
    """Shared device, availability and write path for the two habit buttons."""

    _attr_has_entity_name = True

    def __init__(
        self, coordinator: TaskTickCoordinator, entry: ConfigEntry, habit_id: str
    ) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._habit_id = habit_id

    @property
    def _habit(self) -> dict[str, Any] | None:
        return self.coordinator.data.habit_by_id(self._habit_id)

    @property
    def available(self) -> bool:
        return super().available and self._habit is not None

    @property
    def device_info(self) -> DeviceInfo:
        habit = self._habit or {}
        return DeviceInfo(
            identifiers={(DOMAIN, f"{self._entry.entry_id}_{self._habit_id}")},
            name=habit.get("name") or "TaskTick habit",
            manufacturer=MANUFACTURER,
            model="habit",
        )

    async def _write(self, check_in: dict[str, float]) -> None:
        await self.coordinator.client.async_check_in_habit(self._habit_id, check_in)
        await self.coordinator.async_request_refresh()


class TaskTickHabitCompleteButton(TaskTickHabitButton):
    """Meets the habit's target for the day."""

    _attr_name = "Mark as completed"
    _attr_icon = "mdi:check-bold"

    def __init__(
        self, coordinator: TaskTickCoordinator, entry: ConfigEntry, habit_id: str
    ) -> None:
        super().__init__(coordinator, entry, habit_id)
        # `_check_in` predates the split into two buttons; keeping it is what
        # makes this the same entity the installation already has.
        self._attr_unique_id = f"{entry.entry_id}_{habit_id}_check_in"

    async def async_press(self) -> None:
        habit = self._habit
        if habit is None:
            return
        await self._write(completion_check_in(habit))


class TaskTickHabitIncompleteButton(TaskTickHabitButton):
    """Clears the habit's entry for the day."""

    _attr_name = "Mark as incomplete"
    _attr_icon = "mdi:close-circle-outline"

    def __init__(
        self, coordinator: TaskTickCoordinator, entry: ConfigEntry, habit_id: str
    ) -> None:
        super().__init__(coordinator, entry, habit_id)
        self._attr_unique_id = f"{entry.entry_id}_{habit_id}_incomplete"

    async def async_press(self) -> None:
        await self._write(INCOMPLETE_CHECK_IN)
