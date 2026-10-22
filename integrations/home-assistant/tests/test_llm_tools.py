"""The tool list TaskTick offers a conversation agent.

An agent can only add an event if ``TaskTickCreateEvent`` is one of its tools.
Home Assistant 2026.10 changed where that list comes from: until 2026.9 it wrapped
every registered intent handler itself, so registering the handler was the whole
job. From 2026.10 the `llm` integration asks each loaded integration for a `llm.py`
platform and takes the tools from there — an integration with handlers but no
platform contributes nothing, and the agent answers "I can only read events".

A missing tool and a model that ignores one look identical from the outside, so
what these tests pin is the wiring: the platform hands over one tool per intent,
named the way Home Assistant demands, and `tasktick.assist_tools` reports both
the platform's list and the agent's.
"""

from __future__ import annotations

import asyncio

import pytest
from ha_version import require_supported_ha

require_supported_ha()

from homeassistant.core import HomeAssistant  # noqa: E402
from homeassistant.helpers import intent, llm  # noqa: E402

from custom_components.tasktick import async_setup as tasktick_setup  # noqa: E402
from custom_components.tasktick import intents as intents_module  # noqa: E402
from custom_components.tasktick import llm as tasktick_llm  # noqa: E402
from custom_components.tasktick.const import DOMAIN  # noqa: E402

needs_tools_platform = pytest.mark.skipif(
    not tasktick_llm.LLM_TOOLS_SUPPORTED,
    reason="this Home Assistant predates the llm tools platform",
)
needs_legacy_intents = pytest.mark.skipif(
    tasktick_llm.LLM_TOOLS_SUPPORTED,
    reason="from 2026.10 the intent store is no longer wrapped automatically",
)


def _run(tmp_path, body):
    async def scenario():
        hass = HomeAssistant(str(tmp_path))
        try:
            return await body(hass)
        finally:
            await hass.async_stop(force=True)

    return asyncio.run(scenario())


def _context() -> "llm.LLMContext":
    return llm.LLMContext(
        platform="conversation",
        context=None,
        language="en",
        assistant="conversation",
        device_id=None,
    )


async def _offered(hass: HomeAssistant) -> dict[str, dict[str, str]]:
    """What our platform hands a conversation agent, by tool name."""

    intents_module.async_setup_intents(hass)
    offered = await tasktick_llm.async_get_tools(
        hass, _context(), llm.LLM_API_ASSIST
    )
    assert offered is not None, "the platform offered nothing"
    return {
        tool.name: {
            "title": tool.title or "",
            "description": tool.description or "",
            "integration": tool.integration or "",
        }
        for tool in offered.tools
    }


def test_the_titles_cover_every_intent() -> None:
    """A tool missing from either list is invisible and reports nothing.

    `INTENT_TYPES` drives registration, `LLM_TITLES` drives the tools. They are
    two lists because a title is prose, and they have to agree.
    """

    assert set(tasktick_llm.LLM_TITLES) == set(intents_module.INTENT_TYPES)


@needs_tools_platform
def test_every_intent_has_a_tool(tmp_path) -> None:
    """One tool per registered handler, and nothing else."""

    async def body(hass: HomeAssistant) -> set[str]:
        return set(await _offered(hass))

    names = _run(tmp_path, body)

    assert names == {f"{DOMAIN}__{intent_type}" for intent_type in intents_module.INTENT_TYPES}


@needs_tools_platform
def test_every_tool_is_prefixed_with_the_integration(tmp_path) -> None:
    """Home Assistant refuses an unprefixed tool from 2027.3, and warns before.

    `_async_report_tool_issues` in the `llm` integration checks the prefix, so a
    tool named after the intent alone would log a warning on every assistant
    request and then stop working.
    """

    async def body(hass: HomeAssistant) -> list[str]:
        return list(await _offered(hass))

    names = _run(tmp_path, body)

    assert names
    assert all(name.startswith(f"{DOMAIN}__") for name in names)


@needs_tools_platform
def test_every_tool_names_the_integration_that_provides_it(tmp_path) -> None:
    """A tool without `integration` is reported as untagged and loses attribution."""

    async def body(hass: HomeAssistant) -> dict[str, str]:
        return {name: tool["integration"] for name, tool in (await _offered(hass)).items()}

    integrations = _run(tmp_path, body)

    assert set(integrations.values()) == {DOMAIN}


@needs_tools_platform
def test_the_calendar_tool_reads_like_the_way_in(tmp_path) -> None:
    """The title is what the model sees in the tool list; the description decides.

    Core's own calendar tool only reads, so an agent with nothing else answers
    that it cannot add an event — which is the report this module came from.
    """

    async def body(hass: HomeAssistant) -> dict[str, str]:
        return (await _offered(hass))[f"{DOMAIN}__TaskTickCreateEvent"]

    tool = _run(tmp_path, body)

    assert tool["title"] == "Add a calendar event"
    assert "calendar" in tool["description"].lower()
    assert "friday" in tool["description"]
    assert "all-day" in tool["description"]


@needs_tools_platform
def test_another_api_is_offered_nothing(tmp_path) -> None:
    """The model-control protocol is not the Assist API, and gets no tools here."""

    async def body(hass: HomeAssistant):
        intents_module.async_setup_intents(hass)
        return await tasktick_llm.async_get_tools(hass, _context(), "mcp")

    assert _run(tmp_path, body) is None


@needs_tools_platform
def test_no_registered_handler_means_no_tools(tmp_path) -> None:
    """Half a tool list is worse than none: the agent would answer confidently.

    Nothing is registered in this scenario, which is what an entry that never
    finished setting up looks like from the platform's side.
    """

    async def body(hass: HomeAssistant):
        return await tasktick_llm.async_get_tools(
            hass, _context(), llm.LLM_API_ASSIST
        )

    assert _run(tmp_path, body) is None


@needs_legacy_intents
def test_older_home_assistant_wraps_the_handlers_itself(tmp_path) -> None:
    """Before 2026.10 the intent store was the tool list, so registration sufficed."""

    async def body(hass: HomeAssistant) -> set[str]:
        intents_module.async_setup_intents(hass)
        instance = await llm.async_get_api(hass, llm.LLM_API_ASSIST, _context())
        return {tool.name for tool in instance.tools}

    assert set(intents_module.INTENT_TYPES) <= _run(tmp_path, body)


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


def test_tasktick_intents_do_not_need_anything_exposed(tmp_path) -> None:
    """Exposure is what gates a core intent, and TaskTick's declare no platform.

    Home Assistant drops an intent handler whose `platforms` name domains none of
    which are exposed. The todo intents are gated that way; these are not, which
    is why nothing has to be exposed for the assistant to add a task, add an
    event, finish one or check in a habit.
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

    async def body(hass: HomeAssistant) -> set[str]:
        assert await tasktick_setup(hass, {}) is True
        offered = await tasktick_llm.async_get_tools(
            hass, _context(), llm.LLM_API_ASSIST
        )
        names: set[str] = set()
        if offered is not None:
            names |= {tool.name for tool in offered.tools}
        try:
            legacy = await llm.async_get_api(hass, llm.LLM_API_ASSIST, _context())
        except Exception:  # noqa: BLE001 - the Assist API is set up by a real instance
            pass
        else:
            names |= {tool.name for tool in legacy.tools}
        return names

    names = _run(tmp_path, body)

    assert f"{DOMAIN}__TaskTickCreateEvent" in names or "TaskTickCreateEvent" in names


def test_assist_tools_reports_the_platform_and_the_agent(tmp_path) -> None:
    """The diagnostic has to separate "no platform" from "agent did not get it".

    Those are different faults with different fixes, and from the assistant's
    side they read identically — the report this service exists for.
    """

    async def body(hass: HomeAssistant) -> dict:
        assert await tasktick_setup(hass, {}) is True
        return await hass.services.async_call(
            DOMAIN, "assist_tools", {}, blocking=True, return_response=True
        )

    result = _run(tmp_path, body)

    assert sorted(result["tasktick_intents"]) == sorted(intents_module.INTENT_TYPES)
    assert result["ha_version"]
    assert "platform_tools" in result
    assert "tools_platform" in result
    if tasktick_llm.LLM_TOOLS_SUPPORTED:
        assert result["tools_platform"] is True
        assert len(result["platform_tools"]) == len(intents_module.INTENT_TYPES)
        assert f"{DOMAIN}__TaskTickCreateEvent" in result["tasktick_tools"]
    else:
        assert result["tools_platform"] is False
        assert len(result["tasktick_tools"]) == len(intents_module.INTENT_TYPES)
