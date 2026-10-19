"""The reminder transport, driven through Home Assistant's own webhook plumbing.

The webhook registry, the URL derivation and the dispatch a POST goes through are
all real here, because those are the parts that can be wrong in a way no fake
would notice: an unregistered webhook, a URL with the wrong host, a 200 answered
to a request that was never delivered. What is faked is the far side of both
directions — the TaskTick client, which records the address it is handed, and HA
Reminders, a service that records the notification it is asked to send.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from http import HTTPStatus

from ha_version import require_supported_ha

require_supported_ha()

from homeassistant.components import webhook  # noqa: E402
from homeassistant.core import HomeAssistant  # noqa: E402
from homeassistant.exceptions import HomeAssistantError  # noqa: E402
from homeassistant.helpers.storage import Store  # noqa: E402
from homeassistant.util.aiohttp import MockRequest  # noqa: E402

from ha_fakes import config_entry  # noqa: E402

from custom_components.tasktick.api import TaskTickError  # noqa: E402
from custom_components.tasktick.delivery import ReminderDelivery  # noqa: E402
from custom_components.tasktick.delivery import async_discard_mirrored_reminders  # noqa: E402
from custom_components.tasktick.reminders import (  # noqa: E402
    DEFAULT_ICON,
    REMINDERS_CREATE,
    REMINDERS_DELETE,
    REMINDERS_DOMAIN,
    REMINDERS_NOTIFY,
)

ORIGIN = "http://tasktick.test"
INTERNAL_URL = "http://ha.test:8123"
WEBHOOK_DOMAIN = "webhook"

#: What TaskTick posts for a task reminder: its own `NotificationPayload`, which is
#: the object its Web Push transport renders too.
TASK_NOTIFICATION = {
    "title": "Buy milk",
    "body": "Shopping",
    "type": "info",
    "url": "/tasks?task=t1",
    "tag": "task:t1",
    "actions": [{"action": "complete", "title": "Complete"}],
    "data": {"source": "task", "sourceId": "t1", "occurrenceKey": "2026-05-04T09:00:00.000Z"},
}

#: The same notification as an `ha_reminders.notify` payload: the app's own words,
#: the link absolutised against the origin the user reaches TaskTick on, and the
#: button wired back to TaskTick's own service.
TASK_PAYLOAD = {
    "title": "Buy milk",
    "icon": DEFAULT_ICON,
    "acknowledge_action_title": "Complete",
    "message": "Shopping",
    "click_url": f"{ORIGIN}/tasks?task=t1",
    "acknowledge_actions": [{"service": "tasktick.complete_task", "data": {"task_id": "t1"}}],
}


class FakeClient:
    """Records the addresses TaskTick is told about."""

    #: `ReminderDelivery` absolutises the app path against it, so a fake without an
    #: origin fails on the first notification rather than at construction.
    origin = ORIGIN

    def __init__(self, *, refuse: bool = False) -> None:
        self.addresses: list[str] = []
        self.refuse = refuse

    async def async_register_reminder_delivery(self, webhook_url):
        if self.refuse:
            raise TaskTickError("TaskTick is not taking registrations")
        self.addresses.append(webhook_url)
        return {"webhookUrl": webhook_url, "registeredAtMs": 0}


def _notify_service(calls: list, *, fail: bool = False) -> Callable:
    """A stand-in for HA Reminders' one-off service.

    A plain function, not a callable object: Home Assistant decides whether to
    await a handler with `inspect.iscoroutinefunction`, which is false for an
    instance with an `async def __call__` — the call is then never awaited and the
    service silently does nothing.
    """

    async def _handle(call) -> None:
        if fail:
            raise HomeAssistantError("no notify service is configured")
        calls.append(dict(call.data))

    return _handle


async def _build(
    tmp_path,
    *,
    services: tuple[str, ...] = (REMINDERS_NOTIFY,),
    url: str | None = INTERNAL_URL,
    client: FakeClient | None = None,
    notify_fails: bool = False,
):
    """A ready Home Assistant, a fake client, and the delivery object."""
    hass = HomeAssistant(str(tmp_path))
    hass.config.config_dir = str(tmp_path)
    if url is not None:
        hass.config.internal_url = url

    calls: list = []
    for service in services:
        hass.services.async_register(
            REMINDERS_DOMAIN, service, _notify_service(calls, fail=notify_fails)
        )

    fake = client or FakeClient()
    return hass, fake, calls, ReminderDelivery(hass, fake)


async def _with(tmp_path, body, **kwargs):
    """Run a test body against a started delivery, then tear Home Assistant down."""
    hass, client, calls, delivery = await _build(tmp_path, **kwargs)
    try:
        await delivery.async_start()
        return await body(hass, client, calls, delivery)
    finally:
        await hass.async_stop()


def _refusing_service() -> Callable:
    """A service that fails the way HA Reminders does for a reminder that is gone."""

    async def _handle(call) -> None:
        raise HomeAssistantError("reminder not found")

    return _handle


async def _post(hass, delivery, payload) -> object:
    """One POST, through the same dispatch a real request would take."""
    content = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    request = MockRequest(content=content, mock_source="tasktick", method="POST")
    return await webhook.async_handle_webhook(hass, delivery._webhook_id, request)


def _run(coro):
    return asyncio.run(coro)


def _decoded(response) -> dict:
    return json.loads(response.text)


# -- claiming delivery ----------------------------------------------------- #


def test_the_address_is_offered_on_every_poll(tmp_path):
    async def body(hass, client, calls, delivery):
        assert len(client.addresses) == 1
        assert client.addresses[0].startswith(f"{INTERNAL_URL}/api/webhook/")

        # Every poll re-offers it, so the app's claim of the address stays fresh
        # and removal anywhere costs one stale poll rather than a lost reminder.
        await delivery.async_sync()
        assert client.addresses == [client.addresses[0], client.addresses[0]]

    _run(_with(tmp_path, body))


def test_nothing_is_offered_without_ha_reminders(tmp_path):
    async def body(hass, client, calls, delivery):
        assert client.addresses == []
        # Registering the webhook regardless is what makes this recoverable: the
        # integration being installed later starts delivery without a restart.
        assert delivery._webhook_id in hass.data[WEBHOOK_DOMAIN]

    _run(_with(tmp_path, body, services=()))


def test_an_older_ha_reminders_is_not_claimed(tmp_path):
    async def body(hass, client, calls, delivery):
        # `create` stores a reminder; claiming delivery on a release without the
        # one-off service would answer every POST with an error, so TaskTick must
        # be left to its own push.
        assert client.addresses == []

    _run(_with(tmp_path, body, services=(REMINDERS_CREATE,)))


def test_no_url_means_nothing_is_offered(tmp_path):
    async def body(hass, client, calls, delivery):
        # A fresh instance with nothing configured has no address to hand over.
        assert client.addresses == []
        assert delivery._webhook_id in hass.data[WEBHOOK_DOMAIN]

    _run(_with(tmp_path, body, url=None))


def test_a_client_that_refuses_the_registration_is_survivable(tmp_path):
    async def body(hass, client, calls, delivery):
        assert client.addresses == []
        # No exception: a failed registration means the app keeps sending its own
        # notifications, which is the same state as being uninstalled.
        await delivery.async_sync()

    _run(_with(tmp_path, body, client=FakeClient(refuse=True)))


# -- delivering one reminder ----------------------------------------------- #


def test_a_notification_is_sent_as_a_one_off(tmp_path):
    async def body(hass, client, calls, delivery):
        response = await _post(hass, delivery, TASK_NOTIFICATION)
        assert response.status == HTTPStatus.OK
        assert _decoded(response) == {"delivered": "ha_reminders"}
        assert calls == [TASK_PAYLOAD]

    _run(_with(tmp_path, body))


def test_a_habit_notification_carries_the_day_it_was_for(tmp_path):
    async def body(hass, client, calls, delivery):
        response = await _post(
            hass,
            delivery,
            {
                "title": "Go for a run",
                "url": "/habits?habit=h1",
                "data": {"source": "habit", "sourceId": "h1", "occurrenceKey": "2026-05-04:420"},
            },
        )
        assert response.status == HTTPStatus.OK
        assert calls == [
            {
                "title": "Go for a run",
                "icon": DEFAULT_ICON,
                "acknowledge_action_title": "Check in",
                "click_url": f"{ORIGIN}/habits?habit=h1",
                "acknowledge_actions": [
                    {
                        "service": "tasktick.check_in_habit",
                        "data": {"habit": "h1", "date": "2026-05-04"},
                    }
                ],
            }
        ]

    _run(_with(tmp_path, body))


def test_a_refused_send_is_answered_so_tasktick_falls_back(tmp_path):
    async def body(hass, client, calls, delivery):
        response = await _post(hass, delivery, TASK_NOTIFICATION)
        # The status is the whole contract: a 2xx means delivered, anything else
        # makes the app send this reminder itself.
        assert response.status == HTTPStatus.SERVICE_UNAVAILABLE
        assert "error" in _decoded(response)
        assert calls == []

    _run(_with(tmp_path, body, notify_fails=True))


def test_a_notification_about_nothing_is_refused(tmp_path):
    async def body(hass, client, calls, delivery):
        response = await _post(hass, delivery, {"title": "Buy milk"})
        assert response.status == HTTPStatus.BAD_REQUEST
        assert calls == []

    _run(_with(tmp_path, body))


def test_a_notification_without_a_title_is_refused(tmp_path):
    async def body(hass, client, calls, delivery):
        response = await _post(
            hass, delivery, {"data": {"source": "task", "sourceId": "t1"}}
        )
        assert response.status == HTTPStatus.BAD_REQUEST
        assert calls == []

    _run(_with(tmp_path, body))


def test_a_body_that_is_not_json_is_refused(tmp_path):
    async def body(hass, client, calls, delivery):
        response = await _post(hass, delivery, b"not json")
        assert response.status == HTTPStatus.BAD_REQUEST
        assert calls == []

    _run(_with(tmp_path, body))


def test_a_body_that_is_not_an_object_is_refused(tmp_path):
    async def body(hass, client, calls, delivery):
        response = await _post(hass, delivery, b"[1, 2]")
        assert response.status == HTTPStatus.BAD_REQUEST
        assert calls == []

    _run(_with(tmp_path, body))


# -- taking the old mirror's reminders back out ---------------------------- #


def test_the_reminders_the_old_mirror_created_are_removed(tmp_path):
    async def body(hass, client, calls, delivery):
        store = Store(hass, 1, f"tasktick.reminder_mirror.{config_entry().entry_id}")
        await store.async_save(
            {
                "reminders": {
                    "task:t1:off:30": {"reminder_id": "r1", "fingerprint": "aaa"},
                    "habit:h1:420": {"reminder_id": "r2", "fingerprint": "bbb"},
                    "event:e1:60": {"fingerprint": "ccc"},
                }
            }
        )

        removed = await async_discard_mirrored_reminders(hass, config_entry())

        assert removed == 2
        assert calls == [{"reminder_id": "r1"}, {"reminder_id": "r2"}]
        # The store goes with them, which is what makes this run only once.
        assert await store.async_load() is None
        assert await async_discard_mirrored_reminders(hass, config_entry()) == 0
        assert calls == [{"reminder_id": "r1"}, {"reminder_id": "r2"}]

    _run(_with(tmp_path, body, services=(REMINDERS_NOTIFY, REMINDERS_DELETE)))


def test_a_mirrored_reminder_that_is_already_gone_is_not_a_failure(tmp_path):
    async def body(hass, client, calls, delivery):
        store = Store(hass, 1, f"tasktick.reminder_mirror.{config_entry().entry_id}")
        await store.async_save({"reminders": {"task:t1:off:30": {"reminder_id": "r1"}}})

        # HA Reminders raises for an unknown id — the user having deleted it in its
        # panel is the outcome this is after, not an error.
        hass.services.async_remove(REMINDERS_DOMAIN, REMINDERS_DELETE)
        hass.services.async_register(REMINDERS_DOMAIN, REMINDERS_DELETE, _refusing_service())
        assert await async_discard_mirrored_reminders(hass, config_entry()) == 0
        assert await store.async_load() is None

    _run(_with(tmp_path, body, services=(REMINDERS_NOTIFY, REMINDERS_DELETE)))


def test_mirrored_reminders_are_kept_for_a_later_setup_without_ha_reminders(tmp_path):
    async def body(hass, client, calls, delivery):
        store = Store(hass, 1, f"tasktick.reminder_mirror.{config_entry().entry_id}")
        await store.async_save({"reminders": {"task:t1:off:30": {"reminder_id": "r1"}}})

        # Nothing here can delete anything, and HA Reminders may be installed
        # tomorrow — the store is the only record of what is still out there.
        assert await async_discard_mirrored_reminders(hass, config_entry()) == 0
        assert await store.async_load() == {"reminders": {"task:t1:off:30": {"reminder_id": "r1"}}}

    _run(_with(tmp_path, body, services=(REMINDERS_NOTIFY,)))


def test_an_unregistered_webhook_still_answers(tmp_path):
    async def body(hass, client, calls, delivery):
        await delivery.async_stop()
        assert delivery._webhook_id is None
        assert hass.data.get(WEBHOOK_DOMAIN) == {}

        # Home Assistant answers an unknown webhook with a 200 on purpose, so the
        # app cannot learn this address is gone; the fifteen-minute freshness
        # window is what actually takes it out of circulation.
        response = await webhook.async_handle_webhook(
            hass,
            "0" * 64,
            MockRequest(content=b"{}", mock_source="tasktick", method="POST"),
        )
        assert response.status == HTTPStatus.OK

    _run(_with(tmp_path, body))
