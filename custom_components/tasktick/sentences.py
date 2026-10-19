"""Installing the Assist sentence templates.

Home Assistant only ever loads custom sentences from
``<config>/custom_sentences/<language>/`` — never from an integration package —
so the templates ship inside the integration and are copied into place by the
``tasktick.install_sentences`` service, which then reloads the conversation
agent so they take effect without a restart.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

_LOGGER = logging.getLogger(__name__)

SENTENCES_FILENAME = "tasktick.yaml"
DEFAULT_LANGUAGE = "en"
CONFIG_SENTENCES_DIR = "custom_sentences"
PACKAGE_SENTENCES_DIR = Path(__file__).parent / "custom_sentences"


def packaged_path(language: str) -> Path:
    """Return the packaged template path for a language."""
    return PACKAGE_SENTENCES_DIR / language / SENTENCES_FILENAME


def config_path(hass: HomeAssistant, language: str) -> Path:
    """Return the destination path inside the Home Assistant config dir."""
    return Path(hass.config.path(CONFIG_SENTENCES_DIR, language, SENTENCES_FILENAME))


async def async_reload_conversation(hass: HomeAssistant, language: str) -> bool:
    """Ask the conversation agent to reload its sentence templates."""
    if not hass.services.has_service("conversation", "reload"):
        _LOGGER.warning(
            "conversation.reload is unavailable; restart Home Assistant (or "
            "reload the Conversation integration) to activate the sentences"
        )
        return False
    try:
        await hass.services.async_call(
            "conversation", "reload", {"language": language}, blocking=True
        )
    except Exception as err:  # noqa: BLE001 - report, don't fail the install
        _LOGGER.warning("Could not reload the conversation agent: %s", err)
        return False
    return True


async def async_install_sentences(
    hass: HomeAssistant, language: str = DEFAULT_LANGUAGE
) -> dict[str, Any]:
    """Copy the packaged TaskTick sentences into the config directory.

    An existing file whose content differs is backed up to ``.bak`` first, so
    local edits are never silently overwritten.
    """
    source = packaged_path(language)
    if not source.is_file():
        raise HomeAssistantError(
            f"No packaged TaskTick sentences for language '{language}'"
        )

    target = config_path(hass, language)
    content = await hass.async_add_executor_job(source.read_text, "utf-8")

    def _write() -> tuple[bool, str | None]:
        """Write the templates; return (changed, backup path)."""
        target.parent.mkdir(parents=True, exist_ok=True)
        backup: str | None = None
        if target.is_file():
            existing = target.read_text(encoding="utf-8")
            if existing == content:
                return False, None
            backup_file = target.with_name(f"{target.name}.bak")
            backup_file.write_text(existing, encoding="utf-8")
            backup = str(backup_file)
        target.write_text(content, encoding="utf-8")
        return True, backup

    changed, backup = await hass.async_add_executor_job(_write)
    reloaded = await async_reload_conversation(hass, language)

    if changed:
        _LOGGER.info(
            "Installed TaskTick sentences at %s%s",
            target,
            f" (previous file backed up to {backup})" if backup else "",
        )
    else:
        _LOGGER.info("TaskTick sentences already up to date at %s", target)

    return {
        "path": str(target),
        "updated": changed,
        "backup": backup,
        "reloaded": reloaded,
    }
