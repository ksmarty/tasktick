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
#: The second body shape the webhook accepts. A reminder body has no `kind`, so
#: every payload TaskTick sent before this existed keeps its old meaning.
CLEAR_KIND = "clear"

#: HA Reminders' service that removes a notification: it sends the companion
#: app's `clear_notification` with the tag it was sent under. The tag is the only
#: thing that has to be known here, and TaskTick names it when it sends.
CLEAR_SERVICE = "clear"


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
    """The item a payload is about.

    A reminder carries it inside `data`, next to the other fields the companion
    app reads; a clear names it at the top level, because it is the whole point of
    that body rather than one more thing to display. Both shapes are read here so
    the two callers agree about which notifications belong to which item.
    """
    for candidate in (payload.get("sourceId"), _data(payload).get("sourceId")):
        if isinstance(candidate, str) and candidate:
            return candidate
    return None


def _data(payload: Mapping[str, Any]) -> Mapping[str, Any]:
    """The `data` mapping of a payload, or an empty one when it is not a mapping."""
    data = payload.get("data")
    return data if isinstance(data, Mapping) else {}


def _clear_tags(request: Mapping[str, Any]) -> list[str]:
    """The tags a clear names, in the order they are worth clearing.

    TaskTick sends the oldest first, so the last one is the notification for
    today — the one a confirmation should replace.
    """
    raw = request.get("tags")
    candidates = raw if isinstance(raw, (list, tuple)) else ()
    return [tag.strip() for tag in candidates if isinstance(tag, str) and tag.strip()]


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
            await self.hass.services.async_call(
                REMINDERS_DOMAIN, REMINDERS_NOTIFY, payload, blocking=True
            )
        except HomeAssistantError as err:
            _LOGGER.warning("HA Reminders could not send a notification: %s", err)
            return json_response({"error": str(err)}, status=HTTPStatus.SERVICE_UNAVAILABLE)

        return json_response({"delivered": "ha_reminders"})

    # -- clearing ---------------------------------------------------------- #

    async def _async_clear(self, request: Mapping[str, Any]) -> Response:
        """Take away the notifications one item was sent for, and maybe say well done.

        Always a 2xx: unlike a reminder there is no second transport to fall back
        to, and a clear that could not be delivered is not an error the user can
        act on — the notification simply stays where it was.

        The tags are TaskTick's own (it names them, one per occurrence, when it
        posts the reminder), so nothing has to be remembered between the send and
        the clear: naming the same tag is the whole operation.
        """
        tags = _clear_tags(request)
        if not tags:
            return json_response(
                {"error": "expected the tags that were sent"}, status=HTTPStatus.BAD_REQUEST
            )

        cleared = 0
        if self.hass.services.has_service(REMINDERS_DOMAIN, CLEAR_SERVICE):
            try:
                cleared = await self._async_drop(tags)
            except HomeAssistantError as err:
                # Not fatal: the confirmation is still worth sending, and a
                # notification that has to be swiped away beats a failed check-in.
                _LOGGER.debug("HA Reminders could not clear a notification: %s", err)
        else:  # pragma: no cover - an HA Reminders older than the clear service
            _LOGGER.debug("HA Reminders has no clear service; notifications stay")

        confirmed = False
        message = request.get("message")
        if isinstance(message, Mapping) and isinstance(message.get("title"), str):
            try:
                confirmed = await self._async_confirm(message, tags[-1])
            except Exception:  # noqa: BLE001 - the note is optional
                _LOGGER.debug("could not confirm a TaskTick check-in", exc_info=True)

        if cleared or confirmed:
            _LOGGER.debug(
                "cleared %s TaskTick notification(s) (confirmed: %s)", cleared, confirmed
            )
        return json_response({"cleared": cleared, "confirmed": confirmed})

    async def _async_drop(self, tags: list[str]) -> int:
        """Ask HA Reminders to send `clear_notification` for each tag.

        The notify service is HA Reminders' to choose: a clear has to go out on
        the same service the notification did, and it already resolves that (its
        default option, or the one the reminder named), so this stays out of it.
        """
        options: dict[str, Any] = {"tag": tags}
        response = await self.hass.services.async_call(
            REMINDERS_DOMAIN, CLEAR_SERVICE, options, blocking=True, return_response=True
        )
        if isinstance(response, Mapping):
            cleared = response.get("cleared")
            if isinstance(cleared, int):
                return cleared
        return len(tags)

    async def _async_confirm(self, message: Mapping[str, Any], tag: str) -> bool:
        """Show the short "you did it" note under the tag just cleared.

        Reusing the tag is deliberate: the notification it replaces is gone, so
        the note takes its place rather than stacking beside it.
        """
        body = message.get("body")
        payload: dict[str, Any] = {
            "title": str(message.get("title")),
            "message": body if isinstance(body, str) and body else "Done.",
            "tag": tag,
        }
        try:
            await self.hass.services.async_call(
                REMINDERS_DOMAIN, REMINDERS_NOTIFY, payload, blocking=True
            )
        except HomeAssistantError as err:
            _LOGGER.debug("could not confirm a TaskTick check-in: %s", err)
            return False
        return True

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
