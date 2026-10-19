"""Sensors: account totals, and a streak and progress pair per habit.

The account sensors are the ones worth graphing — a completed-per-30-days number
and the current streak both have a meaningful history. The per-habit pair exists
so an automation can say "if I haven't moved today, remind me", which needs
``progress`` as a percentage rather than a yes/no.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import (
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfTime
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
    entities: list[SensorEntity] = [
        TaskTickOpenTasksSensor(coordinator, entry),
        TaskTickCompletedSensor(coordinator, entry),
        TaskTickAccountStreakSensor(coordinator, entry),
    ]
    for habit in coordinator.data.habits:
        entities.append(TaskTickHabitStreakSensor(coordinator, entry, habit["id"]))
        entities.append(TaskTickHabitProgressSensor(coordinator, entry, habit["id"]))
    async_add_entities(entities)


def account_device(entry: ConfigEntry, coordinator: TaskTickCoordinator) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=f"TaskTick ({coordinator.client.origin})",
        manufacturer=MANUFACTURER,
        configuration_url=coordinator.client.origin,
    )


class TaskTickAccountSensor(CoordinatorEntity[TaskTickCoordinator], SensorEntity):
    """Shared plumbing for the three account-wide sensors."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: TaskTickCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_{self.key}"

    key: str = "sensor"

    @property
    def device_info(self) -> DeviceInfo:
        return account_device(self._entry, self.coordinator)


class TaskTickOpenTasksSensor(TaskTickAccountSensor):
    key = "open_tasks"
    _attr_name = "Open tasks"
    _attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        return len(self.coordinator.data.tasks)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "by_list": {
                task_list["name"]: task_list.get("openTaskCount")
                for task_list in self.coordinator.data.lists
            }
        }


class TaskTickCompletedSensor(TaskTickAccountSensor):
    key = "completed_30d"
    _attr_name = "Completed in 30 days"
    _attr_state_class = SensorStateClass.TOTAL
    _attr_icon = "mdi:check-circle-outline"

    @property
    def native_value(self) -> int:
        return int(self.coordinator.data.stats.get("totalCompleted") or 0)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"completed_by_day": self.coordinator.data.stats.get("completedByDay") or []}


class TaskTickAccountStreakSensor(TaskTickAccountSensor):
    key = "streak"
    _attr_name = "Productivity streak"
    _attr_native_unit_of_measurement = UnitOfTime.DAYS
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:fire"

    @property
    def native_value(self) -> int:
        return int(self.coordinator.data.stats.get("currentStreakDays") or 0)


class TaskTickHabitSensor(CoordinatorEntity[TaskTickCoordinator], SensorEntity):
    """Shared plumbing for the per-habit sensors."""

    _attr_has_entity_name = True
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: TaskTickCoordinator, entry: ConfigEntry, habit_id: str) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._habit_id = habit_id
        self._attr_unique_id = f"{entry.entry_id}_{habit_id}_{self.key}"

    key: str = "habit"

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


class TaskTickHabitStreakSensor(TaskTickHabitSensor):
    key = "streak"
    _attr_name = "Streak"
    _attr_native_unit_of_measurement = UnitOfTime.DAYS
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:fire"

    @property
    def native_value(self) -> int:
        habit = self._habit or {}
        return int(habit.get("streak") or 0)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        habit = self._habit or {}
        return {
            "longest_streak": habit.get("longestStreak"),
            "completion_rate": habit.get("completionRate"),
            "frequency": habit.get("frequency"),
            "goal_type": habit.get("goalType"),
            "goal_target": habit.get("goalTarget"),
            "unit": habit.get("unit"),
        }


class TaskTickHabitProgressSensor(TaskTickHabitSensor):
    key = "progress"
    _attr_name = "Progress"
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:progress-check"

    @property
    def native_value(self) -> float:
        habit = self._habit or {}
        # `progress` arrives as a 0–1 fraction against the day's target.
        return round(float(habit.get("progress") or 0) * 100, 1)
