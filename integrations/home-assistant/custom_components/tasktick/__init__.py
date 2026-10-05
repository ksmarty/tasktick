"""Set up the TaskTick integration."""

from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TaskTickClient
from .const import CONF_TOKEN, CONF_URL, CONF_VERIFY_SSL, DEFAULT_SCAN_INTERVAL, DOMAIN
from .coordinator import TaskTickCoordinator
from .services import async_setup_services, async_unload_services
from . import intents as intents_module

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.CALENDAR,
    Platform.SENSOR,
    Platform.TODO,
]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up TaskTick from a config entry."""
    client = TaskTickClient(
        async_get_clientsession(hass),
        entry.data[CONF_URL],
        entry.data[CONF_TOKEN],
        verify_ssl=entry.data.get(CONF_VERIFY_SSL, True),
    )

    coordinator = TaskTickCoordinator(hass, entry, client)
    coordinator.update_interval = _scan_interval(entry)

    # Raises ConfigEntryNotReady itself if the instance is unreachable, so a
    # restart while TaskTick is down retries rather than failing permanently.
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    async_setup_services(hass)
    # Registered once per setup and idempotent: the handlers are process-wide and
    # resolve their coordinator at call time, so a second config entry does not
    # double-register them.
    intents_module.async_setup_intents(hass)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not hass.data[DOMAIN]:
            async_unload_services(hass)
    return unloaded


def _scan_interval(entry: ConfigEntry) -> timedelta:
    seconds = entry.options.get("scan_interval")
    if not seconds:
        return DEFAULT_SCAN_INTERVAL
    return timedelta(seconds=int(seconds))


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Apply new options without a restart."""
    coordinator: TaskTickCoordinator | None = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if coordinator is not None:
        coordinator.update_interval = _scan_interval(entry)
