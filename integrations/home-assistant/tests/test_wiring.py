"""Structural checks that need no Home Assistant runtime.

These read the files as text. That is deliberate: the things worth pinning here
are cross-file agreements (an intent named in three places, a service described
in two), and a typo in any one of them fails silently at runtime — the sentence
simply never matches, or the tool never appears.
"""

from __future__ import annotations

import json
from pathlib import Path
import re

import pytest
import yaml

PACKAGE = Path(__file__).resolve().parent.parent / "custom_components" / "tasktick"
SENTENCES = PACKAGE / "custom_sentences" / "en" / "tasktick.yaml"

_SLOT_RE = re.compile(r"\{([a-z_]+)\}")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _registered_intent_types() -> set[str]:
    """The intent types `async_setup_intents` actually registers."""
    return set(re.findall(r"intent_type = \"(\w+)\"", _read(PACKAGE / "intents.py")))


def _declared_intent_types() -> set[str]:
    """The intent types `intents.py` lists in `INTENT_TYPES`."""
    block = re.search(
        r"INTENT_TYPES: tuple\[str, \.\.\.\] = \((.*?)\)",
        _read(PACKAGE / "intents.py"),
        re.S,
    )
    assert block is not None, "INTENT_TYPES not found in intents.py"
    return set(re.findall(r"\"(\w+)\"", block.group(1)))


def _services_yaml() -> dict:
    return yaml.safe_load(_read(PACKAGE / "services.yaml")) or {}


def _registered_services() -> set[str]:
    """Every `SERVICE_*` constant in services.py, by its string value."""
    return set(re.findall(r"^SERVICE_\w+ = \"(\w+)\"", _read(PACKAGE / "services.py"), re.M))


class TestSentenceTemplates:
    @pytest.fixture(scope="class")
    @staticmethod
    def parsed() -> dict:
        return yaml.safe_load(_read(SENTENCES))

    def test_declares_english(self, parsed: dict) -> None:
        assert parsed["language"] == "en"

    def test_every_intent_exists(self, parsed: dict) -> None:
        unknown = set(parsed["intents"]) - _registered_intent_types()
        assert not unknown, f"sentences name intents that do not exist: {sorted(unknown)}"

    def test_every_intent_is_reachable_by_voice(self, parsed: dict) -> None:
        # An intent with no sentence can only be reached by an LLM, which is not
        # what a user without an LLM agent expects.
        missing = _registered_intent_types() - set(parsed["intents"])
        assert not missing, f"intents have no sentences: {sorted(missing)}"

    def test_every_slot_is_declared(self, parsed: dict) -> None:
        declared = set(parsed["lists"])
        used: set[str] = set()
        for intent in parsed["intents"].values():
            for group in intent["data"]:
                for sentence in group["sentences"]:
                    used |= set(_SLOT_RE.findall(sentence))
        assert used <= declared, f"undeclared slots: {sorted(used - declared)}"

    def test_declared_slots_are_used(self, parsed: dict) -> None:
        # A wildcard slot nobody references is dead weight; worse, it looks like
        # the sentence covers something it does not.
        declared = set(parsed["lists"])
        used: set[str] = set()
        for intent in parsed["intents"].values():
            for group in intent["data"]:
                for sentence in group["sentences"]:
                    used |= set(_SLOT_RE.findall(sentence))
        assert declared <= used, f"slots declared but never used: {sorted(declared - used)}"

    def test_every_intent_has_sentences(self, parsed: dict) -> None:
        for name, intent in parsed["intents"].items():
            assert intent.get("data"), f"{name} has no data block"
            for group in intent["data"]:
                assert group.get("sentences"), f"{name} has an empty sentence list"


class TestIntentTypes:
    def test_the_declared_list_matches_the_registered_handlers(self) -> None:
        # The failure this prevents: a handler nothing can call, or a declared
        # name no handler answers. Assist builds its tools from the *registered*
        # intents, so a handler missing from this list is a handler the model
        # cannot see.
        assert _declared_intent_types() == _registered_intent_types()


class TestServicesYaml:
    def test_every_service_is_described(self) -> None:
        documented = set(_services_yaml())
        assert _registered_services() <= documented, (
            f"services with no services.yaml entry: "
            f"{sorted(_registered_services() - documented)}"
        )

    def test_no_orphan_descriptions(self) -> None:
        documented = set(_services_yaml())
        assert documented <= _registered_services(), (
            f"services.yaml describes services that do not exist: "
            f"{sorted(documented - _registered_services())}"
        )

    def test_every_field_has_a_selector(self) -> None:
        # A field with no selector renders as a raw text box — a boolean or a
        # number then arrives as a string the schema has to coerce.
        for service, definition in _services_yaml().items():
            for field, spec in (definition.get("fields") or {}).items():
                assert "selector" in spec, f"{service}.{field} has no selector"


class TestTranslations:
    def test_english_matches_strings_json(self) -> None:
        # `strings.json` is the source; `translations/en.json` is what ships. If
        # they drift, the UI shows raw keys.
        source = json.loads(_read(PACKAGE / "strings.json"))
        shipped = json.loads(_read(PACKAGE / "translations" / "en.json"))
        assert source == shipped

    def test_every_config_step_has_a_title(self) -> None:
        strings = json.loads(_read(PACKAGE / "strings.json"))
        # The options flow lives in the same file; its steps are checked below.
        config_source = _read(PACKAGE / "config_flow.py").split("class TaskTickOptionsFlow", 1)[0]
        steps = set(re.findall(r"async_step_(\w+)\(", config_source))
        # `zeroconf` and `reauth` only dispatch to their `_confirm` step, which is
        # where the form — and therefore the strings — live.
        steps -= {"zeroconf", "reauth"}
        documented = set(strings["config"]["step"])
        assert steps <= documented, f"steps with no strings: {sorted(steps - documented)}"

    def test_every_options_step_has_a_title(self) -> None:
        strings = json.loads(_read(PACKAGE / "strings.json"))
        options_source = _read(PACKAGE / "config_flow.py").split("class TaskTickOptionsFlow", 1)[1]
        steps = set(re.findall(r"async_step_(\w+)\(", options_source))
        documented = set(strings["options"]["step"])
        assert steps <= documented, f"options steps with no strings: {sorted(steps - documented)}"

    def test_every_flow_error_has_a_message(self) -> None:
        strings = json.loads(_read(PACKAGE / "strings.json"))
        flow_source = _read(PACKAGE / "config_flow.py")
        raised = set(re.findall(r"errors\[\"base\"\] = \"(\w+)\"", flow_source))
        raised |= set(re.findall(r"errors\[CONF_URL\] = \"(\w+)\"", flow_source))
        documented = set(strings["config"]["error"])
        assert raised <= documented, f"errors with no message: {sorted(raised - documented)}"
