"""Buttons: check a habit in, without an automation.

A button is the cheapest way to make "I did it" a physical or dashboard action —
and, unlike a service call, it needs no YAML, which matters because habit
check-ins are the thing people actually want on a wall panel.

The check-in is sent as ``delta: 1`` rather than an absolute count. That is
correct for both habit kinds: a boolean habit's target is 1, so one increment
meets it, and a count habit accumulates rather than being reset to whatever the
button assumed the current value was.
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
    async_add_entities(
        TaskTickHabitCheckInButton(coordinator, entry, habit["id"])
        for habit in coordinator.data.habits
    )


class TaskTickHabitCheckInButton(CoordinatorEntity[TaskTickCoordinator], ButtonEntity):
    """Records one check-in for a habit."""

    _attr_has_entity_name = True
    _attr_name = "Check in"
    _attr_icon = "mdi:check-bold"

    def __init__(self, coordinator: TaskTickCoordinator, entry: ConfigEntry, habit_id: str) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._habit_id = habit_id
        self._attr_unique_id = f"{entry.entry_id}_{habit_id}_check_in"

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
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, f"{self._entry.entry_id}_{self._habit_id}")},
            name=self.name or "TaskTick habit",
            manufacturer=MANUFACTURER,
            model="habit",
        )

    async def async_press(self) -> None:
        await self.coordinator.client.async_check_in_habit(self._habit_id, {"delta": 1})
        await self.coordinator.async_request_refresh()
