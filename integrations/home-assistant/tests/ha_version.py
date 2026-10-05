"""Skips the Home Assistant-dependent tests on an unsupported Home Assistant.

`hacs.json` declares the oldest release this integration supports, and HACS
refuses to install below it. The tests need the same floor: they construct a real
`TaskTickCoordinator`, and `DataUpdateCoordinator.__init__` only grew its
`config_entry` keyword in 2024.4, so on anything older every test errors at
construction with a `TypeError` that looks like a bug in the integration.

Calling this at module level makes the mismatch visible as a skip instead. It is
not a way to avoid testing: CI installs the newest Home Assistant, so these tests
run there.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

# `hacs.json` sits at the repository root because that is where HACS reads it,
# even though the integration itself lives under `integrations/`.
_HACS = json.loads(
    (Path(__file__).parents[3] / "hacs.json").read_text()
)


def require_supported_ha() -> None:
    """Skip the calling module when the installed Home Assistant is too old."""
    pytest.importorskip("homeassistant")
    # The version lives in `homeassistant.const`, not on the package itself.
    from homeassistant.const import __version__ as installed_version

    minimum = _HACS.get("homeassistant")
    if not minimum:
        return

    from packaging.version import Version

    if Version(installed_version) < Version(minimum):
        pytest.skip(
            f"needs Home Assistant >= {minimum}, this environment has "
            f"{installed_version} (CI runs the newest)",
            allow_module_level=True,
        )
