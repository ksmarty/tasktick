"""Stand-ins for the Home Assistant objects a coordinator needs.

A real `ConfigEntry`, not a `SimpleNamespace`: `DataUpdateCoordinator.__init__`
registers an unload callback on it, so a stand-in that only carries `entry_id`
fails at construction with an `AttributeError` that reads like a bug in the
integration.
"""

from __future__ import annotations

import inspect
from types import MappingProxyType

from homeassistant.config_entries import ConfigEntry

from custom_components.tasktick.const import DOMAIN


def config_entry(*, options: dict | None = None) -> ConfigEntry:
    """A config entry pointing at a fake TaskTick, on any supported Home Assistant.

    The constructor's keyword set moves between releases — `subentries_data`
    became required in 2026.2 — so the arguments are filtered against the
    installed signature rather than guessed at.
    """
    fields: dict = {
        "data": {"url": "http://tasktick.test", "token": "tt_test"},
        "discovery_keys": MappingProxyType({}),
        "domain": DOMAIN,
        "entry_id": "test",
        "minor_version": 1,
        "options": options or {},
        "source": "user",
        "subentries_data": None,
        "title": "TaskTick",
        "unique_id": None,
        "version": 1,
    }
    accepted = inspect.signature(ConfigEntry.__init__).parameters
    return ConfigEntry(**{key: value for key, value in fields.items() if key in accepted})
