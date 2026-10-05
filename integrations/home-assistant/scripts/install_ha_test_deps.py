#!/usr/bin/env python3
"""Installs the Home Assistant component requirements the tests need.

pip does not install a component's requirements alongside Home Assistant itself —
they are resolved when the component is first used. Two of them matter here, and
neither can be left unpinned:

- ``hassil`` 3.5.0, which Home Assistant 2026.2 pins, is published as a
  **pre-release**. An unpinned ``pip install hassil`` therefore resolves to an
  older stable release, and the conversation component then fails to import with
  ``ModuleNotFoundError: No module named 'hassil.fuzzy'`` — a missing symbol
  rather than a version mismatch, so it reads like a bug in this integration. It
  cost a CI failure to find.
- ``home-assistant-intents`` moves in lockstep with Home Assistant and has no
  compatible range.

So the versions are read out of the installed Home Assistant's own manifests
instead of being written down here, where they would go stale on the next
release.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# The components whose requirements the tests exercise: `conversation` for the
# Assist API, and the platforms the integration implements.
COMPONENTS = ("conversation", "todo", "calendar")


def _package_name(requirement: str) -> str:
    """The distribution name from a PEP 508 requirement, for de-duplication."""
    return requirement.split("==")[0].split(">=")[0].split("[")[0].strip().lower()


def requirements() -> list[str]:
    import homeassistant

    root = Path(homeassistant.__file__).parent / "components"
    by_package: dict[str, str] = {}
    for name in COMPONENTS:
        manifest = root / name / "manifest.json"
        if not manifest.is_file():
            continue
        for requirement in json.loads(manifest.read_text()).get("requirements", []):
            by_package.setdefault(_package_name(requirement), requirement)
    return sorted(by_package.values())


def main() -> int:
    wanted = requirements()
    if not wanted:
        print("no component requirements found; nothing to install")
        return 0
    print("installing:", ", ".join(wanted))
    subprocess.check_call([sys.executable, "-m", "pip", "install", *wanted])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
