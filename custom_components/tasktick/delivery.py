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
#: The field it answers with once the one-off service supports a response: the id
#: whose tag decides which notification a later clear has to replace.
_FIELD_NOTIFICATION_ID = "notification_id"

#: The second body shape the webhook accepts. A reminder body has no `kind`, so
#: every payload TaskTick sent before this existed keeps its old meaning.
CLEAR_KIND = "clear"

#: The companion app's documented way to remove a notification: send its tag
#: again, with this message instead of a body.
CLEAR_MESSAGE = "clear_notification"

#: HA Reminders picks the notification's tag itself, so the tag a clear has to
#: name is its own format, not ours. Read from that integration where possible
#: and mirrored here for an older release that does not expose its constants.
try:  # pragma: no cover - the fallback is the reason this is guarded
    from ..ha_reminders.const import CONF_DEFAULT_NOTIFY_SERVICE  # noqa: F401
    from ..ha_reminders.const import NOTIFICATION_TAG as _REMINDER_NOTIFICATION_TAG
except ImportError:  # pragma: no cover
    CONF_DEFAULT_NOTIFY_SERVICE = "default_notify_service"
    _REMINDER_NOTIFICATION_TAG = "taskReminder\u2561{reminder_id}"

#: How many sent notifications are remembered per item. A reminder is one
#: notification per occurrence, and only the recent few can still be on a phone.
_SENT_PER_SOURCE = 12


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


def _source_id(payload: Mapping[str, Any]) -> str | None:
    """The item a payload is about, from its `data.sourceId`."""
    data = payload.get("data")
    if not isinstance(data, Mapping):
        return None
    source_id = data.get("sourceId")
    return source_id if isinstance(source_id, str) and source_id else None


def _parse_notify_target(value: str) -> tuple[str, str]:
    """Reads HA Reminders' `notify_service` option the way it does itself."""
    domain, _, service = value.partition(".")
    if service:
        return domain, service
    return "notify", domain


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
        # Which notification ids were sent for which item, so a clear can find
        # them again. Memory only: after a restart the integration cannot name
        # what it sent before, and a notification that has to be swiped away by
        # hand is a smaller failure than a clear aimed at the wrong tag.
        self._sent: dict[str, list[str]] = {}

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

        if notification.get("kind") == CLEAR_KIND:
            return await self._async_clear(notification)

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
            notification_id = await self._async_notify(payload)
        except HomeAssistantError as err:
            _LOGGER.warning("HA Reminders could not send a notification: %s", err)
            return json_response({"error": str(err)}, status=HTTPStatus.SERVICE_UNAVAILABLE)

        source_id = _source_id(notification)
        if notification_id is not None and source_id is not None:
            self._remember_sent(source_id, notification_id)

        return json_response({"delivered": "ha_reminders"})

    # -- clearing ---------------------------------------------------------- #

    async def _async_clear(self, request: Mapping[str, Any]) -> Response:
        """Close what was sent for one item, and optionally say well done.

        Always a 2xx: unlike a reminder there is no second transport to fall back
        to, and a clear that could not be delivered is not an error the user can
        act on — the notification simply stays where it was.
        """
        source_id = _source_id(request)
        if source_id is None:
            return json_response(
                {"error": "expected a sourceId"}, status=HTTPStatus.BAD_REQUEST
            )

        cleared = 0
        for notification_id in self._sent.pop(source_id, []):
            if await self._async_close(notification_id):
                cleared += 1

        confirmed = False
        message = request.get("message")
        if isinstance(message, Mapping) and isinstance(message.get("title"), str):
            confirmed = await self._async_confirm(message)

        if cleared or confirmed:
            _LOGGER.debug(
                "cleared %s TaskTick notification(s) for %s (confirmed: %s)",
                cleared,
                source_id,
                confirmed,
            )
        return json_response({"cleared": cleared, "confirmed": confirmed})

    async def _async_close(self, notification_id: str) -> bool:
        """Ask the notify target to drop one notification by its tag."""
        target = self._notify_target()
        if target is None:
            return False

        try:
            await self.hass.services.async_call(
                *target,
                {
                    "message": CLEAR_MESSAGE,
                    "data": {"tag": _REMINDER_NOTIFICATION_TAG.format(reminder_id=notification_id)},
                },
                blocking=True,
            )
        except HomeAssistantError as err:
            _LOGGER.debug("could not clear a TaskTick notification: %s", err)
            return False
        return True

    async def _async_confirm(self, message: Mapping[str, Any]) -> bool:
        """Show the short "you did it" note in place of the reminder."""
        target = self._notify_target()
        if target is None:
            return False

        body = message.get("body")
        try:
            await self.hass.services.async_call(
                *target,
                {
                    "title": message.get("title"),
                    "message": body if isinstance(body, str) and body else "Done.",
                },
                blocking=True,
            )
        except HomeAssistantError as err:
            _LOGGER.debug("could not confirm a TaskTick check-in: %s", err)
            return False
        return True

    def _notify_target(self) -> tuple[str, str] | None:
        """The notify service HA Reminders would use, or None when it names none.

        Read from HA Reminders' own option rather than guessed at. Falling back to
        `notify.notify` would broadcast a clear to every notification platform the
        user has — text-to-speech, a chat bot, a second phone — to remove one
        line from one of them, so not knowing the target means not clearing.
        """
        for entry in self.hass.config_entries.async_entries(REMINDERS_DOMAIN):
            for values in (entry.options, entry.data):
                if not isinstance(values, Mapping):
                    continue
                value = values.get(CONF_DEFAULT_NOTIFY_SERVICE)
                if isinstance(value, str) and value.strip():
                    return _parse_notify_target(value.strip())
        return None

    def _remember_sent(self, source_id: str, notification_id: str) -> None:
        """Keeps the recent notification ids for one item, newest last."""
        recent = self._sent.setdefault(source_id, [])
        recent.append(notification_id)
        if len(recent) > _SENT_PER_SOURCE:
            del recent[: len(recent) - _SENT_PER_SOURCE]

    async def _async_notify(self, payload: Mapping[str, Any]) -> str | None:
        """Sends one notification, returning the id that identifies it.

        The id is what a later clear needs, and HA Reminders only answers with it
        when the call asks for a response. An older HA Reminders raises instead of
        answering, which is not a delivery failure: the notification is sent the
        old way and simply cannot be cleared by this integration afterwards.
        """
        try:
            response = await self.hass.services.async_call(
                REMINDERS_DOMAIN, REMINDERS_NOTIFY, payload, blocking=True, return_response=True
            )
        except HomeAssistantError as err:
            if "response" not in str(err).lower():
                raise
            await self.hass.services.async_call(
                REMINDERS_DOMAIN, REMINDERS_NOTIFY, payload, blocking=True
            )
            return None

        if isinstance(response, Mapping):
            identifier = response.get(_FIELD_NOTIFICATION_ID)
            if isinstance(identifier, str) and identifier:
                return identifier
        return None

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
