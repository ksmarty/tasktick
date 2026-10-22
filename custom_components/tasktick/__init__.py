"""Set up the TaskTick integration."""

from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from .api import TaskTickClient
from .const import CONF_TOKEN, CONF_URL, CONF_VERIFY_SSL, DEFAULT_SCAN_INTERVAL, DOMAIN
from .coordinator import TaskTickCoordinator
from .delivery import ReminderDelivery, async_discard_mirrored_reminders
from .sentences import DEFAULT_LANGUAGE, async_install_sentences
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


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the process-wide parts before any entry is set up.

    Services and intent handlers need no working TaskTick instance: both resolve
    the coordinator when they are called. Registering them here instead of in
    `async_setup_entry` keeps them present when a setup fails — an instance that
    is unreachable at startup leaves the entry retrying, with no entities and,
    before this, no intents either. A voice assistant then has no TaskTick tool
    at all and answers that it cannot do the thing, which reads as a missing
    feature rather than a TaskTick that is down.
    """

    async_setup_services(hass)
    intents_module.async_setup_intents(hass)
    return True


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

    # The reminder transport: TaskTick still owns the schedule, but its reminders
    # are posted here and answered with a notification that has a button for
    # finishing the item. It rides the poll so the claim stays fresh, and does
    # nothing at all when HA Reminders is not installed.
    delivery = ReminderDelivery(hass, client)
    await delivery.async_start()
    coordinator.delivery = delivery

    # Upgrading from a release that mirrored the schedule: take its reminders back
    # out of HA Reminders rather than leaving them to fire for a schedule nothing
    # maintains. The store it recorded them in is removed with them, so this is a
    # no-op from the second setup onwards.
    await async_discard_mirrored_reminders(hass, entry)

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Services and intents are registered in `async_setup`, before an entry can
    # fail, because both work without a coordinator. Intents are asserted again
    # here: a handler that did not survive is silent — the voice assistant simply
    # answers that it cannot do the thing — so the entry setup re-checks instead
    # of trusting that the process-wide registration is still there.
    intents_module.async_setup_intents(hass)
    # Sentences, every setup: Home Assistant only loads custom sentences from the
    # config directory, so the packaged templates have to be copied there before a
    # sentence can match — and a release that adds one would otherwise need a
    # manual step after every update. The installer compares before writing, so an
    # unchanged install costs one file read.
    await _async_install_sentences(hass)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        coordinator: TaskTickCoordinator | None = hass.data[DOMAIN].pop(entry.entry_id, None)
        if coordinator is not None and coordinator.delivery is not None:
            # The webhook goes with the entry: TaskTick keeps its own delivery
            # until the claim it holds goes stale, which is minutes, not never.
            await coordinator.delivery.async_stop()
        if not hass.data[DOMAIN]:
            async_unload_services(hass)
    return unloaded


async def _async_install_sentences(hass: HomeAssistant) -> None:
    """Install the Assist sentence templates, and never fail setup over it.

    A config directory that cannot be written (a read-only mount, a permissions
    mistake) is worth a warning in the log, not a config entry that will not load:
    everything except the built-in conversation agent keeps working without them.
    """
    try:
        await async_install_sentences(hass, DEFAULT_LANGUAGE)
    except Exception as err:  # noqa: BLE001 - see the docstring
        _LOGGER.warning("Could not install the TaskTick Assist sentences: %s", err)


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
