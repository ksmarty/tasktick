"""Runs the reminder mirror once per poll, and keeps the mapping it needs.

The split from ``mirror.py`` is deliberate: that module is pure — schedule in,
payloads and a diff out — so the interesting decisions can be tested without Home
Assistant. This one is the part that talks to Home Assistant: the HA Reminders
service call, the store that survives a restart, and the delivery claim that
silences TaskTick's own notification.

## What happens on one poll

1. Is HA Reminders installed? If not, do nothing at all — including not claiming
   delivery, because the app's notification is then the only one there is.
2. Ask TaskTick for the schedule. A failure here ends the pass: a mirror that
   deleted its reminders because the instance was briefly unreachable would be
   worse than one that is a minute out of date.
3. Diff it against the mapping and apply creates, updates and deletes.
4. Claim delivery, but only after a pass that had no failures — a claim is a
   promise that Home Assistant is delivering, and it must not be made on the
   strength of a write that did not land.

## Why there is a store

``reminder_id`` is HA Reminders' own row id, so remembering it is what makes an
update possible rather than a delete-and-recreate — and it has to survive a Home
Assistant restart, since the reminders it refers to do. The store is keyed by the
config entry, and it is Home Assistant that keeps it: the mapping is knowledge
about Home Assistant's reminders, not about TaskTick's schedule.
"""
from __future__ import annotations

import logging
from typing import Any, Mapping

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .api import TaskTickClient, TaskTickError
from .const import DOMAIN
from .mirror import MIRRORED_SOURCES, desired_reminders, fingerprint, reconcile
from .reminders import (
    REMINDERS_CREATE,
    REMINDERS_DELETE,
    REMINDERS_DOMAIN,
    REMINDERS_UPDATE,
)

_LOGGER = logging.getLogger(__name__)

# Bumped only if the shape of what is stored changes.
STORE_VERSION = 1
STORE_KEY = f"{DOMAIN}.reminder_mirror"


class ReminderMirror:
    """Mirrors TaskTick's reminder schedule into HA Reminders."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: TaskTickClient | None = None,
    ) -> None:
        self.hass = hass
        self.entry = entry
        #: Only the sync needs it; removal only ever deletes what is already
        #: recorded, and Home Assistant does not keep the entry's client around
        #: that long.
        self.client = client
        self._store: Store[dict[str, Any]] = Store(hass, STORE_VERSION, f"{STORE_KEY}.{entry.entry_id}")
        #: TaskTick key -> {"reminder_id": str, "fingerprint": str}
        self._entries: dict[str, dict[str, Any]] = {}
        self._loaded = False

    # -- lifecycle --------------------------------------------------------- #

    async def async_load(self) -> None:
        """Read the mapping from Home Assistant's storage, once."""
        if self._loaded:
            return
        stored = await self._store.async_load() or {}
        reminders = stored.get("reminders")
        if isinstance(reminders, Mapping):
            self._entries = {
                str(key): dict(value) for key, value in reminders.items() if isinstance(value, Mapping)
            }
        self._loaded = True

    async def async_stop(self) -> None:
        """Delete every reminder this mirror created.

        Called when the config entry is removed, not when it is merely unloaded:
        a restart must keep the reminders, while removing the integration must not
        leave notifications behind whose buttons call a service that no longer
        exists.
        """
        await self.async_load()

        if not self._available:
            # Nothing can be deleted, and nothing will be able to later either, so
            # the mapping is dropped rather than kept alive in storage.
            await self._store.async_remove()
            return

        for key, existing in list(self._entries.items()):
            reminder_id = existing.get("reminder_id")
            if reminder_id and await self._async_delete(str(reminder_id)):
                self._entries.pop(key, None)

        if not self._entries:
            await self._store.async_remove()
        else:
            await self._store.async_save({"reminders": self._entries})

    # -- the poll ---------------------------------------------------------- #

    @property
    def _available(self) -> bool:
        """Whether HA Reminders is installed and able to take a reminder."""
        return self.hass.services.has_service(REMINDERS_DOMAIN, REMINDERS_CREATE)

    async def async_sync(self) -> None:
        """One reconciliation pass. Never raises: the poll must not depend on it."""
        await self.async_load()

        if not self._available:
            # Nothing to mirror into. The mapping is kept, not cleared: HA
            # Reminders may only be reloading, and forgetting the ids would make
            # the next pass create duplicates of reminders that still exist.
            _LOGGER.debug("HA Reminders is not available; skipping the reminder mirror")
            return

        if self.client is None:
            return

        try:
            entries = await self.client.async_scheduled_reminders()
        except TaskTickError as err:
            _LOGGER.warning("could not read TaskTick's reminder schedule: %s", err)
            return
        # The schedule's instants are absolute and HA Reminders schedules on wall
        # clock, so the zone they are rendered in is Home Assistant's own: that is
        # the clock the notification time will be read against.
        desired = desired_reminders(entries, self.client.origin, self.hass.config.time_zone)
        plan = reconcile(desired, self._entries)
        if plan.empty:
            await self._async_register()
            return

        _LOGGER.debug("reminder mirror: %s", plan)
        intact = await self._async_apply(plan, desired)
        if intact:
            await self._async_register()

    async def _async_register(self) -> None:
        """Tell TaskTick that Home Assistant is delivering these sources."""
        try:
            await self.client.async_register_reminder_delivery(list(MIRRORED_SOURCES))
        except TaskTickError as err:
            # Worth a warning: until this lands the user gets two notifications
            # for the same reminder, which is exactly what the claim prevents.
            _LOGGER.warning("could not claim reminder delivery from TaskTick: %s", err)

    async def _async_apply(self, plan: Any, desired: Mapping[str, Mapping[str, Any]]) -> bool:
        """Carry out a plan, keeping the mapping in step. True when nothing failed."""
        changed = False
        intact = True

        for key, payload in plan.create:
            reminder_id = await self._async_create(payload)
            if reminder_id:
                self._entries[key] = {"reminder_id": reminder_id, "fingerprint": fingerprint(payload)}
                changed = True
            else:
                intact = False

        for key, reminder_id, payload in plan.update:
            if await self._async_update(reminder_id, payload):
                self._entries[key] = {"reminder_id": reminder_id, "fingerprint": fingerprint(payload)}
                changed = True
            else:
                intact = False

        for key, reminder_id in plan.delete:
            if await self._async_delete(reminder_id):
                self._entries.pop(key, None)
                changed = True
            else:
                intact = False

        if changed:
            await self._store.async_save({"reminders": self._entries})

        return intact

    # -- the service calls ------------------------------------------------- #

    async def _async_create(self, payload: Mapping[str, Any]) -> str | None:
        response = await self._async_call(REMINDERS_CREATE, dict(payload), keys=("reminder_id",))
        reminder_id = response.get("reminder_id") if response else None
        return str(reminder_id) if reminder_id else None

    async def _async_update(self, reminder_id: str, payload: Mapping[str, Any]) -> bool:
        body = {**payload, "reminder_id": reminder_id}
        return await self._async_call(REMINDERS_UPDATE, body, keys=None) is not None

    async def _async_delete(self, reminder_id: str) -> bool:
        return await self._async_call(REMINDERS_DELETE, {"reminder_id": reminder_id}, keys=None) is not None

    async def _async_call(
        self, service: str, data: dict[str, Any], *, keys: tuple[str, ...] | None
    ) -> dict[str, Any] | None:
        """Call one HA Reminders service, reporting failure rather than raising.

        ``None`` means the call failed, which the caller turns into "keep the
        previous mapping and try again next poll" — retrying is always safe here
        because every service is idempotent for a given reminder id.
        """
        try:
            # `return_response` is only asked for where the service documents a
            # response: ``delete`` answers with nothing, and asking anyway is an
            # error rather than an empty dict.
            response = await self.hass.services.async_call(
                REMINDERS_DOMAIN,
                service,
                data,
                blocking=True,
                return_response=keys is not None,
            )
        except Exception as err:  # noqa: BLE001 - a background job must not raise
            _LOGGER.warning("HA Reminders rejected %s for %s: %s", service, data.get("title", "?"), err)
            return None

        if keys is None:
            return {}
        if isinstance(response, Mapping):
            return {key: response.get(key) for key in keys}
        return {}
