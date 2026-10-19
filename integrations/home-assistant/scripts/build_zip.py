#!/usr/bin/env python3
"""Builds the archive HACS installs, at integrations/home-assistant/tasktick.zip.

The integration's source lives at ``custom_components/tasktick/`` in the root of
this repository, which is where HACS insists an integration sits.

The layout *inside* the zip is not that one. HACS downloads a release asset and
unpacks it straight into ``config/custom_components/<domain>/`` — its
``HacsIntegrationRepository.localpath`` is ``f"{config_path}/custom_components/
{domain}"`` and the downloader calls ``extractall`` on it without stripping a
prefix — so an archive carrying ``custom_components/tasktick/…`` lands one level
too deep (``…/tasktick/custom_components/tasktick/…``) and Home Assistant never
sees the integration. The archive therefore holds the integration's contents at
its root: ``manifest.json``, ``__init__.py``, …, the way every ``zip_release``
integration ships.

``hacs.json`` at the repository root sets ``zip_release: true``, which makes HACS
fetch this file from the release assets rather than reading the repository — so
the release workflow must attach it, and a release without it breaks installation
for everyone.

The integration's own ``manifest.json`` carries a hand-written version that
nothing keeps in step with the app it talks to, so the archive is stamped from
the repository's ``package.json`` at build time — HACS reads the version from the
manifest, and a stale one makes it offer an update that changes nothing.

Written against ``zipfile`` rather than shelling out to ``zip`` so it runs
wherever Python does.
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
HOME_ASSISTANT = Path(__file__).resolve().parents[1]
SOURCE = REPO / "custom_components" / "tasktick"
OUT = HOME_ASSISTANT / "tasktick.zip"
MANIFEST = "manifest.json"
PACKAGE_JSON = REPO / "package.json"

# A local test run leaves these behind, and they must not ship in the archive.
SKIP_DIRS = {"__pycache__"}


def app_version() -> str:
    """The version TaskTick is at, which is what the packaged integration claims."""
    try:
        data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"warning: cannot read {PACKAGE_JSON} ({error}); manifest version left alone", file=sys.stderr)
        return ""
    return str(data.get("version", "")).strip()


def stamped_manifest(path: Path, version: str) -> bytes:
    """The manifest with its version replaced, everything else byte-for-byte kept."""
    data = json.loads(path.read_text(encoding="utf-8"))
    data["version"] = version
    return (json.dumps(data, indent=2) + "\n").encode("utf-8")


def main() -> int:
    if not SOURCE.is_dir():
        print(f"error: {SOURCE} is not a directory", file=sys.stderr)
        return 1

    files = sorted(
        path
        for path in SOURCE.rglob("*")
        if path.is_file()
        and not any(part in SKIP_DIRS for part in path.relative_to(SOURCE).parts)
        and path.suffix != ".pyc"
    )
    if not files:
        print(f"error: no files under {SOURCE}", file=sys.stderr)
        return 1

    version = app_version()

    OUT.unlink(missing_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            name = path.relative_to(SOURCE).as_posix()
            if name == MANIFEST and version:
                archive.writestr(name, stamped_manifest(path, version))
            else:
                archive.write(path, name)

    label = f", version {version}" if version else ""
    print(f"wrote {OUT.name}: {len(files)} files, {OUT.stat().st_size} bytes{label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
