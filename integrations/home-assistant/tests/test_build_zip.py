"""The integration archive claims the version the app is actually at.

HACS decides whether to offer an update from the ``version`` in the packaged
``manifest.json``. That field is hand-written and nothing else keeps it in step
with the app it talks to, so the release archive is stamped from the repository's
``package.json`` — and a stale stamp means HACS keeps offering an update that
changes nothing. These cases pin the stamping, without building into the
repository itself.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
PACKAGE_JSON = REPO / "package.json"
MANIFEST = REPO / "custom_components" / "tasktick" / "manifest.json"


def _build_zip_module():
    spec = importlib.util.spec_from_file_location("ha_build_zip", ROOT / "scripts" / "build_zip.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_archive_is_stamped_with_the_app_version() -> None:
    module = _build_zip_module()
    version = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["version"]

    assert module.app_version() == version
    assert module.MANIFEST == "custom_components/tasktick/manifest.json"


def test_stamping_changes_the_version_and_nothing_else() -> None:
    module = _build_zip_module()
    original = json.loads(MANIFEST.read_text(encoding="utf-8"))

    stamped = json.loads(module.stamped_manifest(MANIFEST, "9.9.9").decode("utf-8"))

    assert stamped["version"] == "9.9.9"
    assert {key: value for key, value in stamped.items() if key != "version"} == {
        key: value for key, value in original.items() if key != "version"
    }


def test_the_script_ships_the_integration_where_home_assistant_looks() -> None:
    module = _build_zip_module()

    assert module.SOURCE == REPO / "custom_components" / "tasktick"
    assert module.OUT == ROOT / "tasktick.zip"


def test_the_repository_keeps_the_layout_hacs_accepts() -> None:
    """HACS reads ROOT/custom_components/<domain>/ and refuses anything else.

    The source sat under `integrations/home-assistant/` once, which read better in
    a repository that is mostly an app, and it made HACS answer an install
    attempt with "Repository structure for v0.42.16 is not compliant" — the
    directory *is* the check, so pin it here instead of learning it from a user.
    """
    hacs = json.loads((REPO / "hacs.json").read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    assert manifest["domain"] == "tasktick"
    assert [path.name for path in (REPO / "custom_components").iterdir() if path.is_dir()] == [
        "tasktick"
    ]
    assert hacs["zip_release"] is True
    assert hacs["filename"] == (ROOT / "tasktick.zip").name
