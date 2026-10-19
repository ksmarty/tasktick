"""Deliver TaskTick's reminders through Home Assistant.

TaskTick already knows *when*: its server expands recurrence, computes each fire
time and owns the sent bookkeeping, so a reminder is due exactly once. What it
cannot do reliably is *reach the user*: an installed PWA gets no dependable
background wake-up, while Home Assistant is already awake and its notification
carries a button that finishes the item.

So this module is a transport and nothing else. It registers a webhook with Home
Assistant, hands the URL to TaskTick through the delivery registration the app
already exposes, and turns each POST into one `ha_reminders.notify` call — a
one-off notification that is sent and forgotten. Nothing is stored: no reminder
entry in HA Reminders, no sensor, no bookkeeping to reconcile when a task is
moved, completed in the app, or the app is closed. The schedule stays TaskTick's;
only the notification comes from here.

The registration is a claim, and it expires: TaskTick treats an address it has not
heard about for fifteen minutes as gone and posts the reminder to its own push
instead. So an integration that is removed, disabled, or merely broken costs a
slower notification rather than a lost one, and there is nothing for the user to
configure or switch off.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from aiohttp.web import Request, Response, json_response

from homeassistant.components import webhook
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.network import NoURLAvailableError
from homeassistant.helpers.storage import Store

from .api import TaskTickClient, TaskTickError
from .const import DOMAIN
from .reminders import REMINDERS_DELETE, REMINDERS_DOMAIN, REMINDERS_NOTIFY, notification_payload

_LOGGER = logging.getLogger(__name__)

#: Shown in Home Assistant's webhook bookkeeping (diagnostics, logs) rather than
#: to the user, but it is what identifies this integration's handler among the
#: dozens a running instance registers.
WEBHOOK_NAME = "TaskTick reminder"

#: Where the removed reminder mirror kept the ids of the reminders it created.
#: Nothing writes it any more; it is read once, so an upgrade does not leave a
#: dead schedule behind (see `async_discard_mirrored_reminders`).
_LEGACY_MIRROR_STORE = f"{DOMAIN}.reminder_mirror"
_LEGACY_MIRROR_STORE_VERSION = 1
#: HA Reminders' own field name for the reminder a service call is about.
_FIELD_REMINDER_ID = "reminder_id"


async def async_discard_mirrored_reminders(hass: HomeAssistant, entry: ConfigEntry) -> int:
    """Delete the reminders the old mirror created, and forget its store.

    Older releases mirrored TaskTick's schedule into HA Reminders: one stored
    reminder per slot, whose ids were kept in a `Store` so removal could take them
    back out. This integration no longer creates any, and a mirrored reminder left
    behind would keep firing for a schedule nothing maintains — on the days it was
    made for, with a button that completes a task that may be long gone.

    Runs on setup and does nothing after the first pass, because the store is
    removed once its reminders are. It is deliberately kept when HA Reminders is
    not installed: that is a setup which cannot delete anything *yet*, and the
    store is the only record of what is still out there. Returns how many were
    removed, for the log.
    """
    if not hass.services.has_service(REMINDERS_DOMAIN, REMINDERS_DELETE):
        return 0

    store: Store[dict[str, Any]] = Store(
        hass, _LEGACY_MIRROR_STORE_VERSION, f"{_LEGACY_MIRROR_STORE}.{entry.entry_id}"
    )
    stored = await store.async_load()
    reminders = stored.get("reminders") if isinstance(stored, Mapping) else None
    if not isinstance(reminders, Mapping):
        return 0

    removed = 0
    for value in reminders.values():
        reminder_id = value.get("reminder_id") if isinstance(value, Mapping) else None
        if not reminder_id:
            continue
        try:
            await hass.services.async_call(
                REMINDERS_DOMAIN,
                REMINDERS_DELETE,
                {_FIELD_REMINDER_ID: str(reminder_id)},
                blocking=True,
            )
            removed += 1
        except HomeAssistantError as err:
            # Already gone, most likely: the user deleted it in HA Reminders' own
            # panel, which is exactly the outcome this is after.
            _LOGGER.warning("could not remove a reminder the old mirror created: %s", err)

    await store.async_remove()
    if removed:
        _LOGGER.info("%s reminder(s) from the old reminder mirror were removed", removed)
    return removed


class ReminderDelivery:
    """The webhook TaskTick posts a due reminder to.

    One instance per config entry, held by the coordinator for the lifetime of the
    entry: the webhook id is generated at setup and lives only in memory, so a
    Home Assistant restart simply hands TaskTick a new address on the next poll.
    Nothing about the entry itself is needed to keep it running, which is why the
    registration can stay a bare URL.
    """

    def __init__(self, hass: HomeAssistant, client: TaskTickClient) -> None:
        self.hass = hass
        self.client = client
        self._webhook_id: str | None = None

    # -- lifecycle --------------------------------------------------------- #

    async def async_start(self) -> None:
        """Register the webhook and offer its address to TaskTick.

        Nothing is persisted: the entry holds no webhook id, so a restart of Home
        Assistant registers a fresh one and the app learns it on the next poll.
        """
        webhook_id = webhook.async_generate_id()
        webhook.async_register(self.hass, DOMAIN, WEBHOOK_NAME, webhook_id, self._async_handle)
        self._webhook_id = webhook_id
        await self.async_sync()

    async def async_sync(self) -> None:
        """Re-offer the address, so the app's claim of it stays fresh.

        Called from every poll. It does nothing at all when this Home Assistant
        has no usable URL or when HA Reminders is not installed (or is too old to
        have the one-off service), which is what keeps the integration harmless on
        a setup that cannot deliver: TaskTick never learns about an address that
        would answer with an error and it keeps sending its own notifications.
        """
        if self._webhook_id is None or not self._available():
            return

        url = self._webhook_url()
        if url is None:
            return

        try:
            await self.client.async_register_reminder_delivery(url)
        except TaskTickError as err:
            # Worth a warning: until this lands the user gets the app's own push,
            # which is a worse notification but not a missing one.
            _LOGGER.warning("could not tell TaskTick where to deliver reminders: %s", err)

    async def async_stop(self) -> None:
        """Unregister the webhook; leaves TaskTick to its own push.

        The app is not told: it stops using the address fifteen minutes after the
        last poll anyway, and a stale URL that 404s falls back on the first
        reminder. Removing a webhook on unload is the whole teardown — the
        registration is a URL, not an entry anything else refers to.
        """
        if self._webhook_id is None:
            return
        webhook.async_unregister(self.hass, self._webhook_id)
        self._webhook_id = None

    # -- the handler ------------------------------------------------------- #

    async def _async_handle(
        self, hass: HomeAssistant, webhook_id: str, request: Request
    ) -> Response:
        """One due reminder, as a notification.

        A failure is answered rather than swallowed: a non-2xx is what makes
        TaskTick fall back to its own transport for this reminder, so refusing to
        deliver is a promise the notification still arrives, just later.
        """
        try:
            notification = await request.json()
        except ValueError:
            return json_response(
                {"error": "expected a JSON body"}, status=HTTPStatus.BAD_REQUEST
            )
        if not isinstance(notification, Mapping):
            return json_response(
                {"error": "expected a JSON object"}, status=HTTPStatus.BAD_REQUEST
            )

        try:
            payload = notification_payload(origin=self.client.origin, notification=notification)
        except ValueError as err:
            return json_response({"error": str(err)}, status=HTTPStatus.BAD_REQUEST)

        if not self._available():
            # A ServiceNotFound for a service that is not registered is not worth
            # logging as an error: the answer alone is the useful part.
            return json_response(
                {"error": "HA Reminders is not installed"}, status=HTTPStatus.SERVICE_UNAVAILABLE
            )

        try:
            await hass.services.async_call(
                REMINDERS_DOMAIN, REMINDERS_NOTIFY, payload, blocking=True
            )
        except HomeAssistantError as err:
            _LOGGER.warning("HA Reminders could not send a notification: %s", err)
            return json_response({"error": str(err)}, status=HTTPStatus.SERVICE_UNAVAILABLE)

        return json_response({"delivered": "ha_reminders"})

    # -- helpers ----------------------------------------------------------- #

    def _available(self) -> bool:
        """Whether HA Reminders can send a notification at all.

        The one-off service, not `create`: an older release has the integration but
        not the ability to send something without storing a reminder, and claiming
        delivery there would replace the user's own notification with a 404.
        """
        return self.hass.services.has_service(REMINDERS_DOMAIN, REMINDERS_NOTIFY)

    def _webhook_url(self) -> str | None:
        """The full URL TaskTick should post to, or None when there is none.

        Home Assistant may genuinely have no usable URL — a fresh instance with no
        internal or external address configured — and that is not an error: there
        is nothing to hand over, so the app keeps delivering its own reminders.
        """
        assert self._webhook_id is not None
        try:
            return webhook.async_generate_url(self.hass, self._webhook_id)
        except NoURLAvailableError:
            _LOGGER.warning(
                "this Home Assistant has no URL to reach it on, so TaskTick will "
                "keep sending its own notifications; set the internal or external "
                "URL in Settings > System > Network"
            )
            return None
