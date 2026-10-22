"""Expose the TaskTick intents to conversation agents as LLM tools.

Home Assistant used to wrap every registered intent handler in a tool for the
conversation agents, so registering the handler in `intents.py` was enough.
From 2026.10 the tools are gathered per integration instead: `async_get_tools`
in the `llm` integration walks the loaded integrations, imports a `llm.py`
platform from each and asks it for its tools
(`homeassistant/components/llm/__init__.py`). An integration that only
registers intent handlers contributes nothing, and the agent then answers that
it cannot do the thing — which is exactly what happened to a user on 2026.10.2
who asked for a calendar event.

So this module is the door. Everything it exposes is an `IntentTool` wrapped
around the handler that already exists, which means the tool call and the
spoken sentence take the same code path and cannot drift apart.
"""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .intents import INTENT_TYPES

_LOGGER = logging.getLogger(__name__)

try:
    # Imported here so the module still loads on Home Assistant releases from
    # before the tools platform existed (2026.9 and earlier), where importing
    # `homeassistant.components.llm` raises: on those the intent handlers are
    # wrapped automatically and this platform has nothing to add.
    from homeassistant.components.llm import LLMTools
    from homeassistant.helpers import intent as intent_helper
    from homeassistant.helpers.llm import (
        LLM_API_ASSIST,
        IntentTool,
        LLMContext,
        ToolAnnotations,
    )

    LLM_TOOLS_SUPPORTED = True
except ImportError:  # pragma: no cover - exercised on older Home Assistant
    LLM_TOOLS_SUPPORTED = False

#: The title each tool carries, so a model reads "Add a calendar event" rather
#: than `tasktick__TaskTickCreateEvent`. The keys are checked against
#: `INTENT_TYPES` by `tests/test_llm_tools.py`: a tool missing from either list
#: is invisible, and nothing reports it.
LLM_TITLES: dict[str, str] = {
    "TaskTickAddTask": "Add a task",
    "TaskTickListTasks": "List tasks",
    "TaskTickCompleteTask": "Complete a task",
    "TaskTickDeleteTask": "Delete a task",
    "TaskTickCheckInHabit": "Check in to a habit",
    "TaskTickHabitStatus": "Read habit status",
    "TaskTickCreateEvent": "Add a calendar event",
}

#: Only the two readers are safe to repeat; the writers change state, and both
#: completing and deleting look for something that is still there, so a repeat
#: call raises instead of doing nothing quietly.
_INTENT_ANNOTATIONS = {
    "TaskTickAddTask": {"destructive": False, "open_world": False},
    "TaskTickListTasks": {"read_only": True, "idempotent": True, "open_world": False},
    "TaskTickCompleteTask": {"destructive": False, "open_world": False},
    "TaskTickDeleteTask": {"destructive": True, "open_world": False},
    "TaskTickCheckInHabit": {"destructive": False, "open_world": False},
    "TaskTickHabitStatus": {"read_only": True, "idempotent": True, "open_world": False},
    "TaskTickCreateEvent": {"destructive": False, "open_world": False},
}


def _tool_name(intent_type: str) -> str:
    """The name a model sees.

    Home Assistant wants every tool prefixed with the integration that provides
    it (`_async_report_tool_issues` in the `llm` integration logs a warning per
    unprefixed tool, and refuses them outright from 2027.3).
    """

    return f"{DOMAIN}__{intent_type}"


async def async_get_tools(
    hass: HomeAssistant, llm_context: "LLMContext", api_id: str
) -> "LLMTools | None":
    """Return the TaskTick tools for a conversation agent.

    Returns None when there is nothing to offer, which keeps TaskTick out of
    agents that do not use the Assist API and out of the tool list entirely on
    older Home Assistant releases.
    """

    if not LLM_TOOLS_SUPPORTED:
        return None
    if api_id != LLM_API_ASSIST:
        return None

    tools = [
        IntentTool(
            _tool_name(handler.intent_type),
            handler,
            title=LLM_TITLES.get(handler.intent_type),
            integration=DOMAIN,
            annotations=ToolAnnotations(**_INTENT_ANNOTATIONS.get(handler.intent_type, {})),
        )
        for handler in intent_helper.async_get(hass)
        if handler.intent_type in LLM_TITLES
    ]
    if not tools:
        # The handlers are registered during setup; an empty list here means the
        # entry is not loaded, and a tool list that silently shrinks is worse
        # than an agent that says it does not know how.
        _LOGGER.debug(
            "No TaskTick intent handlers to expose; expected %s",
            ", ".join(INTENT_TYPES),
        )
        return None

    return LLMTools(tools=tools)
