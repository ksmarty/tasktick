"""The sentence templates install themselves.

Home Assistant loads custom sentences only from the config directory, so a release
that adds one has to put the file there itself — otherwise the new sentence is
unreachable until the user finds the action that installs it. These tests drive
the real installer against a temporary config directory, with a stand-in for the
`conversation.reload` service so the reload is observable.
"""

from __future__ import annotations

import asyncio

from ha_version import require_supported_ha

require_supported_ha()

from homeassistant.core import HomeAssistant  # noqa: E402

from custom_components.tasktick.sentences import (  # noqa: E402
    SENTENCES_FILENAME,
    async_install_sentences,
    config_path,
    packaged_path,
)


def _run(coro):
    return asyncio.run(coro)


def _hass(directory, reloads: list | None = None) -> HomeAssistant:
    """A Home Assistant whose config dir is `directory`.

    `conversation.reload` is registered for real, so the installer's call lands
    somewhere it can be counted: the whole point of the install is that the agent
    picks the new sentences up without a restart.
    """

    hass = HomeAssistant(str(directory))
    hass.config.config_dir = str(directory)
    if reloads is not None:

        async def _reload(call):  # noqa: ANN001 - Home Assistant's ServiceCall
            reloads.append(call.data.get("language"))

        hass.services.async_register("conversation", "reload", _reload)
    return hass


def test_install_writes_the_packaged_templates(tmp_path) -> None:
    reloads: list = []

    async def body():
        hass = _hass(tmp_path, reloads)
        try:
            result = await async_install_sentences(hass, "en")
            return result, config_path(hass, "en").read_text(encoding="utf-8")
        finally:
            await hass.async_stop()

    result, installed = _run(body())
    assert result["updated"] is True
    assert result["backup"] is None
    assert SENTENCES_FILENAME in result["path"]
    assert installed == packaged_path("en").read_text(encoding="utf-8")
    # New sentences are not in effect until the agent re-reads its templates.
    assert reloads == ["en"]
    assert result["reloaded"] is True


def test_the_second_install_writes_nothing(tmp_path) -> None:
    """Setup runs on every restart, so a no-op has to cost nothing.

    The reload is the expensive half — it restarts the conversation agent — and
    there is nothing new for it to load.
    """

    reloads: list = []

    async def body():
        hass = _hass(tmp_path, reloads)
        try:
            await async_install_sentences(hass, "en")
            return await async_install_sentences(hass, "en")
        finally:
            await hass.async_stop()

    result = _run(body())
    assert result["updated"] is False
    assert result["reloaded"] is False
    assert reloads == ["en"], "an unchanged install must not reload the agent again"


def test_a_local_edit_is_backed_up_before_it_is_replaced(tmp_path) -> None:
    """The integration's copy wins, but never silently.

    A user who edits this file keeps their version as `.bak`; their own templates
    belong in a different file in the same directory, which this never touches.
    """

    async def body():
        hass = _hass(tmp_path)
        try:
            target = config_path(hass, "en")
            target.parent.mkdir(parents=True)
            target.write_text("language: en\nintents: {}\n", encoding="utf-8")
            result = await async_install_sentences(hass, "en")
            return result, target.read_text(encoding="utf-8")
        finally:
            await hass.async_stop()

    result, installed = _run(body())
    assert result["updated"] is True
    assert result["backup"] is not None
    assert result["backup"].endswith(".bak")
    assert "TaskTickCreateEvent" in installed


def test_another_language_has_no_templates_to_install(tmp_path) -> None:
    """A missing translation must raise, not write an empty file over one."""

    async def body():
        hass = _hass(tmp_path)
        try:
            return await async_install_sentences(hass, "zz")
        finally:
            await hass.async_stop()

    try:
        _run(body())
    except Exception as err:  # noqa: BLE001 - the type comes from Home Assistant
        assert "zz" in str(err)
    else:  # pragma: no cover - the installer is not supposed to succeed here
        raise AssertionError("installing an unknown language should fail")
