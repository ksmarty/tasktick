"""Diagnostics for TaskTick.

The API token is the whole of this integration's authority — it can read and
write every list, habit and calendar on the account — so it is redacted here,
in the config entry *and* in the coordinator's copy of the client.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONF_TOKEN, DOMAIN

TO_REDACT = {CONF_TOKEN, "token"}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """Return diagnostics for a config entry."""
    coordinator = hass.data.get(DOMAIN, {}).get(entry.entry_id)

    diagnostics: dict[str, Any] = {
        "entry": async_redact_data(entry.as_dict(), TO_REDACT),
    }

    if coordinator is None:
        # The entry is set up but unloaded — worth seeing, not worth crashing on.
        diagnostics["coordinator"] = None
        return diagnostics

    data = coordinator.data
    diagnostics["coordinator"] = {
        "last_update_success": coordinator.last_update_success,
        "update_interval_seconds": (
            coordinator.update_interval.total_seconds()
            if coordinator.update_interval
            else None
        ),
        "counts": {
            "lists": len(getattr(data, "lists", []) or []),
            "tasks": len(getattr(data, "tasks", []) or []),
            "habits": len(getattr(data, "habits", []) or []),
            "calendars": len(getattr(data, "calendars", []) or []),
        },
        # Names and ids only: this is what makes a discovery or entity-id
        # question answerable without the user pasting their whole account.
        "lists": [
            {"id": item.get("id"), "name": item.get("name"), "isInbox": item.get("isInbox")}
            for item in (getattr(data, "lists", []) or [])
        ],
        "calendars": [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "readOnly": item.get("readOnly"),
                "isDefault": item.get("isDefault"),
            }
            for item in (getattr(data, "calendars", []) or [])
        ],
        "habits": [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "streak": item.get("streak"),
                "doneToday": item.get("doneToday"),
            }
            for item in (getattr(data, "habits", []) or [])
        ],
    }
    return diagnostics
