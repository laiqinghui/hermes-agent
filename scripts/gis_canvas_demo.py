#!/usr/bin/env python3
"""Restore the GIS-canvas shadow-fleet demo so it can be run any time.

The demo's data handles live in the broker cache (`~/.hermes/gis_canvas_data/`),
which expires entries after HERMES_GIS_DATA_TTL (24h by default). That makes the
demo self-destructing: it works today and is gone tomorrow. This script re-seeds
the broker from the frozen fixture in the repo, so the handles the demo prompt
names always resolve.

Handle ids are preserved (the filename IS the id), so the prompt's
`data://f4e4262d` etc. keep working across restores.

Usage:
    python scripts/gis_canvas_demo.py            # restore handles, print the prompt
    python scripts/gis_canvas_demo.py --check    # report status, change nothing
    python scripts/gis_canvas_demo.py --quiet    # restore only, no prompt

Then paste the printed prompt into the canvas chat. Nothing else is needed --
the analysis is carried in the prompt, so no Denodo round-trips happen.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = REPO / "tests" / "fixtures" / "gis-canvas" / "session-2026-08-31"
HANDLES = FIXTURE / "handles"
PROMPT = FIXTURE / "demo-prompt.md"

# The handles the demo prompt names. Restoring the whole fixture is cheap, but these
# are the ones whose absence actually breaks the demo, so they are what --check reports.
REQUIRED = {
    "f4e4262d": "potential_shadow_fleets suspects",
    "08d4277a": "CLYDE NOBLE monthly AIS activity",
    "c771b7aa": "WONDER VEGA monthly AIS activity",
    "4c10f34c": "TREND monthly AIS activity",
    "1355b700": "AGNI daily AIS activity",
}


def broker_dir() -> pathlib.Path:
    root = os.environ.get("HERMES_GIS_DATA_DIR") or str(
        pathlib.Path.home() / ".hermes" / "gis_canvas_data"
    )
    return pathlib.Path(root)


def ttl_seconds() -> int:
    return int(os.environ.get("HERMES_GIS_DATA_TTL", str(24 * 3600)))


def status(dest: pathlib.Path) -> list[tuple[str, str, str]]:
    """(handle, state, detail) for each required handle. Pure: touches nothing."""
    ttl, now, out = ttl_seconds(), time.time(), []
    for h, label in REQUIRED.items():
        p = dest / f"{h}.json"
        if not p.exists():
            out.append((h, "MISSING", label))
        elif 0 <= ttl < now - p.stat().st_mtime:
            out.append((h, "EXPIRED", label))
        else:
            hours = (ttl - (now - p.stat().st_mtime)) / 3600
            out.append((h, "OK", f"{label} ({hours:.1f}h left)"))
    return out


def restore(dest: pathlib.Path) -> tuple[int, int]:
    """Copy every fixture handle into the broker cache with a fresh mtime.

    copy2 would preserve the fixture's 2026-08-31 mtime and land already-expired,
    so the mtime is reset to now -- that reset IS the point of this script.
    """
    dest.mkdir(parents=True, exist_ok=True)
    copied = rows = 0
    for src in sorted(HANDLES.glob("*.json")):
        shutil.copyfile(src, dest / src.name)
        os.utime(dest / src.name, None)
        copied += 1
        try:
            rows += len(json.loads(src.read_text(encoding="utf-8")).get("rows", []))
        except (OSError, json.JSONDecodeError):
            pass
    return copied, rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="report status only, change nothing")
    ap.add_argument("--quiet", action="store_true", help="restore without printing the prompt")
    args = ap.parse_args()

    if not HANDLES.is_dir():
        print(f"fixture not found: {HANDLES}", file=sys.stderr)
        return 2

    dest = broker_dir()

    if args.check:
        print(f"broker cache : {dest}")
        print(f"TTL          : {ttl_seconds()}s")
        for h, state, detail in status(dest):
            print(f"  {state:<8} data://{h}  {detail}")
        return 0 if all(s == "OK" for _, s, _ in status(dest)) else 1

    copied, rows = restore(dest)
    print(f"restored {copied} handles ({rows} rows) -> {dest}")
    for h, state, detail in status(dest):
        print(f"  {state:<8} data://{h}  {detail}")

    if not args.quiet:
        if PROMPT.exists():
            print("\n" + "=" * 72)
            print("Paste the following into the canvas chat at http://localhost:5174")
            print("=" * 72 + "\n")
            print(PROMPT.read_text(encoding="utf-8"))
        else:
            print(f"\n(prompt file missing: {PROMPT})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
