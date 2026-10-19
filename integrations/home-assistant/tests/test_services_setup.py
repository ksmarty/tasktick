"""The integration's services, registered against a real Home Assistant.

`async_setup_entry` calls `async_setup_services` last, so anything that raises
there takes the whole config entry down: the entities are registered first and
the log shows "Error setting up entry TaskTick (Kyle) for tasktick" with the real
cause buried in the traceback below it. That is how
`SupportsResponse.ALWAYS` shipped — the enum has only NONE, OPTIONAL and ONLY, so
`install_sentences` raised `AttributeError: type object 'SupportsResponse' has no
attribute 'ALWAYS'` on every setup, on every Home Assistant version, and nothing
here noticed because no test ever called the registration.

What is checked is therefore the registration itself, plus the response contract
of each service, because Home Assistant enforces that contract at call time: a
handler declared NONE refuses `return_response=True`, and one declared ONLY
refuses a plain call. Both are wrong for a service that does work and also
answers.
"""

from __future__ import annotations

import asyncio

from homeassistant.core import HomeAssistant, SupportsResponse

from custom_components.tasktick.const import DOMAIN
from custom_components.tasktick.services import (
    SERVICE_CHECK_IN_HABIT,
    SERVICE_COMPLETE_TASK,
    SERVICE_CREATE_EVENT,
    SERVICE_CREATE_REMINDER,
    SERVICE_CREATE_TASK,
    SERVICE_DELETE_EVENT,
    SERVICE_DELETE_TASK,
    SERVICE_INSTALL_SENTENCES,
    SERVICE_UPDATE_EVENT,
    SERVICE_UPDATE_TASK,
    async_setup_services,
    async_unload_services,
)

#: Every service the integration offers, and what it answers with. `OPTIONAL`
#: means the handler returns a summary that a caller may ask for or ignore.
SERVICES = {
    SERVICE_CREATE_TASK: SupportsResponse.OPTIONAL,
    SERVICE_UPDATE_TASK: SupportsResponse.NONE,
    SERVICE_COMPLETE_TASK: SupportsResponse.NONE,
    SERVICE_DELETE_TASK: SupportsResponse.NONE,
    SERVICE_CHECK_IN_HABIT: SupportsResponse.NONE,
    SERVICE_CREATE_EVENT: SupportsResponse.OPTIONAL,
    SERVICE_UPDATE_EVENT: SupportsResponse.NONE,
    SERVICE_DELETE_EVENT: SupportsResponse.NONE,
    SERVICE_CREATE_REMINDER: SupportsResponse.OPTIONAL,
    SERVICE_INSTALL_SENTENCES: SupportsResponse.OPTIONAL,
}


def _run(tmp_path, body):
    """Register the services against a real Home Assistant, then tear it down.

    `async_setup_services` and `async_unload_services` are synchronous despite
    their names — `async_setup_entry` calls them without awaiting — so neither is
    awaited below.
    """

    async def scenario() -> None:
        hass = HomeAssistant(str(tmp_path))
        try:
            await body(hass)
        finally:
            await hass.async_stop()

    return asyncio.run(scenario())


def _registered(hass: HomeAssistant) -> dict:
    return hass.services.async_services().get(DOMAIN, {})


def test_every_service_is_registered(tmp_path):
    async def body(hass: HomeAssistant) -> None:
        async_setup_services(hass)

        assert set(_registered(hass)) == set(SERVICES)

    _run(tmp_path, body)


def test_a_service_that_answers_declares_it(tmp_path):
    async def body(hass: HomeAssistant) -> None:
        async_setup_services(hass)

        # A name that does not exist in the installed Home Assistant raises here,
        # which is the failure this file exists for.
        assert {
            name: handler.supports_response
            for name, handler in _registered(hass).items()
        } == SERVICES

    _run(tmp_path, body)


def test_unload_removes_them(tmp_path):
    async def body(hass: HomeAssistant) -> None:
        async_setup_services(hass)
        async_unload_services(hass)

        assert _registered(hass) == {}

    _run(tmp_path, body)
