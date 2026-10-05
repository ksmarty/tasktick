#!/usr/bin/env python3
"""Builds the archive HACS installs, at integrations/home-assistant/tasktick.zip.

The layout inside the zip is ``custom_components/tasktick/...``, not this
repository's own directory structure. HACS unpacks the archive straight into
``config/``, so the integration has to sit where Home Assistant looks for it.

``hacs.json`` at the repository root sets ``zip_release: true``, which makes HACS
fetch this file from the release assets rather than reading the repository — so
the release workflow must attach it, and a release without it breaks installation
for everyone.

Written against ``zipfile`` rather than shelling out to ``zip`` so it runs
wherever Python does.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "custom_components" / "tasktick"
OUT = ROOT / "tasktick.zip"

# A local test run leaves these behind, and they must not ship in the archive.
SKIP_DIRS = {"__pycache__"}


def main() -> int:
    if not SOURCE.is_dir():
        print(f"error: {SOURCE} is not a directory", file=sys.stderr)
        return 1

    files = sorted(
        path
        for path in SOURCE.rglob("*")
        if path.is_file()
        and not any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts)
        and path.suffix != ".pyc"
    )
    if not files:
        print(f"error: no files under {SOURCE}", file=sys.stderr)
        return 1

    OUT.unlink(missing_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())

    print(f"wrote {OUT.name}: {len(files)} files, {OUT.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
