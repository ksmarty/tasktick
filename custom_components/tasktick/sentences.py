"""Installing the Assist sentence templates.

Home Assistant only ever loads custom sentences from
``<config>/custom_sentences/<language>/`` — never from an integration package —
so the templates ship inside the integration and are copied into place at setup,
which is what makes a new release's sentences arrive with the update. The
``tasktick.install_sentences`` service does the same thing on demand, and both
reload the conversation agent so the sentences take effect without a restart.
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

    Called on every setup as well as from the `install_sentences` action, so it
    has to be cheap and quiet: the packaged file is compared before anything is
    written, and the conversation agent is only reloaded when the content
    actually changed. That is what makes an update install its new sentences
    without a second visit to the UI.

    An existing file whose content differs is backed up to ``.bak`` first. Put
    your own templates in a *different* file under `custom_sentences/<lang>/`:
    this one belongs to the integration and is replaced when its copy changes.
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
    # Reloading restarts the conversation agent, so it is done only when there is
    # something new to load — otherwise every restart would pay for it.
    reloaded = await async_reload_conversation(hass, language) if changed else False

    if changed:
        # A first install is routine; replacing a file that was not ours is the
        # case worth noticing in the log, so the level follows the backup.
        record = _LOGGER.warning if backup else _LOGGER.info
        record(
            "Installed TaskTick sentences at %s%s",
            target,
            f" (the file it replaced is saved as {backup})" if backup else "",
        )
    else:
        _LOGGER.info("TaskTick sentences already up to date at %s", target)

    return {
        "path": str(target),
        "updated": changed,
        "backup": backup,
        "reloaded": reloaded,
    }
