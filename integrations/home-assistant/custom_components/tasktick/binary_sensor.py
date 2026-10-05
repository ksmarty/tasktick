"""Binary sensor: is this habit's target met today.

Separate from the progress sensor because the two answer different questions. An
automation that fires at 21:00 wants a boolean; a dashboard wants the percentage.
``doneToday`` means *the target is met*, not "there is an entry" — a check-in of
1 on a habit needing 8 correctly leaves this off.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import BinarySensorEntity
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
    async_add_entities(
        TaskTickHabitDoneToday(coordinator, entry, habit["id"])
        for habit in coordinator.data.habits
    )


class TaskTickHabitDoneToday(CoordinatorEntity[TaskTickCoordinator], BinarySensorEntity):
    """Whether a habit's target has been met today."""

    _attr_has_entity_name = True
    _attr_name = "Done today"
    _attr_icon = "mdi:check-circle-outline"

    def __init__(self, coordinator: TaskTickCoordinator, entry: ConfigEntry, habit_id: str) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._habit_id = habit_id
        self._attr_unique_id = f"{entry.entry_id}_{habit_id}_done_today"

    @property
    def _habit(self) -> dict[str, Any] | None:
        return self.coordinator.data.habit_by_id(self._habit_id)

    @property
    def name(self) -> str | None:
        habit = self._habit
        return habit["name"] if habit else None

    @property
    def available(self) -> bool:
        return super().available and self._habit is not None

    @property
    def is_on(self) -> bool:
        return bool((self._habit or {}).get("doneToday"))

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, f"{self._entry.entry_id}_{self._habit_id}")},
            name=self.name or "TaskTick habit",
            manufacturer=MANUFACTURER,
            model="habit",
        )
