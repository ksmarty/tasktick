"""The tool list Home Assistant hands to a conversation agent.

An agent can only add an event if ``TaskTickCreateEvent`` is in that list, and
Home Assistant builds the list itself: every registered intent handler becomes a
tool, on top of its own calendar tool — which can only read. A missing tool and a
model that ignores one look identical from the outside, because the model answers
"I can only read events" either way, so what is checked here is the wiring.

The list is built from ``intent.async_get(hass)``, so this registers the real
handlers against a real Home Assistant instead of asserting on the source.
"""

from __future__ import annotations

import asyncio

from homeassistant.core import HomeAssistant
from homeassistant.helpers import intent, llm

from custom_components.tasktick import async_setup as tasktick_setup
from custom_components.tasktick import intents as intents_module
from custom_components.tasktick.const import DOMAIN


def _run(tmp_path, body):
    async def scenario():
        hass = HomeAssistant(str(tmp_path))
        try:
            return await body(hass)
        finally:
            await hass.async_stop(force=True)

    return asyncio.run(scenario())


def _context() -> llm.LLMContext:
    return llm.LLMContext(
        platform="conversation",
        context=None,
        language="en",
        assistant="conversation",
        device_id=None,
    )


async def _tools(hass: HomeAssistant) -> dict[str, str]:
    intents_module.async_setup_intents(hass)
    instance = await llm.async_get_api(hass, llm.LLM_API_ASSIST, _context())
    return {tool.name: tool.description or "" for tool in instance.tools}


def test_every_tasktick_intent_reaches_the_agent(tmp_path) -> None:
    """A handler that is registered but filtered out is invisible to the model.

    The names are the intent types, not snake_case: Home Assistant slugifies the
    intent type without changing its case, so the model is offered
    ``TaskTickCreateEvent`` exactly as the class spells it.
    """

    async def body(hass: HomeAssistant) -> set[str]:
        return set(await _tools(hass))

    names = _run(tmp_path, body)

    assert names >= set(intents_module.INTENT_TYPES)
    assert "TaskTickCreateEvent" in names


def test_the_calendar_tool_names_itself_as_the_way_in(tmp_path) -> None:
    """Descriptions are all the model gets to tell the tools apart."""

    async def body(hass: HomeAssistant) -> dict[str, str]:
        return await _tools(hass)

    descriptions = _run(tmp_path, body)
    create_event = descriptions["TaskTickCreateEvent"]

    assert "calendar" in create_event.lower()
    assert "friday" in create_event
    assert "all-day" in create_event


def test_tasktick_is_the_only_tool_that_mentions_a_calendar(tmp_path) -> None:
    """Core has no tool that writes an event, so this one has no fallback.

    Home Assistant's own calendar tool only appears when calendars are exposed,
    and even then it only reads. In a bare instance TaskTick's intent is the one
    tool that talks about calendars at all — which is why a missing description
    on it made the assistant answer that it could not add events.
    """

    async def body(hass: HomeAssistant) -> dict[str, str]:
        return await _tools(hass)

    descriptions = _run(tmp_path, body)

    mentions_calendar = {
        name for name, text in descriptions.items() if "calendar" in text.lower()
    }
    assert mentions_calendar == {"TaskTickCreateEvent"}


def test_tasktick_intents_do_not_need_anything_exposed(tmp_path) -> None:
    """Exposure is what gates a core intent, and TaskTick's declare no platform.

    Home Assistant drops an intent handler from the tool list when it names
    domains and none of them are exposed (`llm.py`: `intent_handler.platforms is
    None or intent_handler.platforms & exposed_domains`). The todo intents are
    gated that way; these are not, which is why nothing has to be exposed for the
    assistant to add a task, add an event, finish one or check in a habit.
    """

    async def body(hass: HomeAssistant) -> dict[str, set[str] | None]:
        intents_module.async_setup_intents(hass)
        return {
            handler.intent_type: handler.platforms
            for handler in intent.async_get(hass)
            if handler.intent_type in intents_module.INTENT_TYPES
        }

    platforms = _run(tmp_path, body)

    assert set(platforms) == set(intents_module.INTENT_TYPES)
    assert all(value is None for value in platforms.values())


def test_the_intents_survive_a_setup_that_never_completes(tmp_path) -> None:
    """The tools must not depend on a reachable TaskTick instance.

    `async_setup` registers services and intents; `async_setup_entry` — which
    polls and can leave the entry retrying — no longer does. A voice assistant
    with no TaskTick tool has nothing to try, and says so, which reads as a
    missing feature rather than an instance that is down.
    """

    async def body(hass: HomeAssistant) -> tuple[set[str], set[str]]:
        assert await tasktick_setup(hass, {}) is True
        services = set(hass.services.async_services().get(DOMAIN, {}))
        instance = await llm.async_get_api(hass, llm.LLM_API_ASSIST, _context())
        return services, {tool.name for tool in instance.tools}

    services, names = _run(tmp_path, body)

    assert "create_event" in services
    assert "assist_tools" in services
    assert "TaskTickCreateEvent" in names


def test_registering_twice_leaves_one_handler_per_intent(tmp_path) -> None:
    """`async_setup_entry` re-asserts the handlers, so the call has to be quiet.

    Home Assistant only warns when a registration overwrites an existing one, and
    a reload of the config entry runs the setup path again. Registering the same
    seven types a second time must leave the store unchanged rather than filling
    the log with overwrite warnings.
    """

    async def body(hass: HomeAssistant) -> list[str]:
        intents_module.async_setup_intents(hass)
        intents_module.async_setup_intents(hass)
        return [handler.intent_type for handler in intent.async_get(hass)]

    types = _run(tmp_path, body)

    assert sorted(types) == sorted(intents_module.INTENT_TYPES)
    assert len(types) == len(set(types))


def test_a_handler_that_went_missing_is_put_back(tmp_path) -> None:
    """The failure this guards against produces no error anywhere.

    A handler missing from the store is missing from the tool list, and the
    assistant answers that it cannot do the thing — indistinguishable from a
    feature that was never built. Setup therefore re-asserts instead of trusting
    the process-wide registration.
    """

    async def body(hass: HomeAssistant) -> set[str]:
        intents_module.async_setup_intents(hass)
        intent.async_remove(hass, "TaskTickCreateEvent")
        intents_module.async_setup_intents(hass)
        return intents_module.registered_intent_types(hass)

    assert "TaskTickCreateEvent" in _run(tmp_path, body)


def test_assist_tools_reports_the_intent_store(tmp_path) -> None:
    """The diagnostic has to separate "no handler" from "no tool".

    Those are different faults with different fixes, and from the assistant's
    side they read identically.
    """

    async def body(hass: HomeAssistant) -> dict:
        assert await tasktick_setup(hass, {}) is True
        return await hass.services.async_call(
            DOMAIN, "assist_tools", {}, blocking=True, return_response=True
        )

    result = _run(tmp_path, body)

    assert sorted(result["tasktick_intents"]) == sorted(intents_module.INTENT_TYPES)
    assert len(result["tasktick_tools"]) == len(intents_module.INTENT_TYPES)
    assert result["ha_version"]
