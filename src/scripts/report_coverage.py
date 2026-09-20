"""Report what the dataset actually contains, so gaps are visible rather than discovered.

Stage 4 of the pipeline, and the input to the schema-freeze decision. Prints three things:

  1. field coverage  — how many stations have each field, and which are missing it
  2. payload budget  — what is making the JSON big, because it ships to the browser
  3. review flags    — positions that disagree, unparsed text, stations on a default tower

Exits non-zero if anything in the "must hold" set is violated, so this doubles as a
regression check after a future re-scrape.

    uv run src/scripts/report_coverage.py
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

DATA_FILE = Path(__file__).parent.parent / "data" / "lighthouses.json"

# Fields every station must have for the app to function. A miss here fails the run.
REQUIRED = ["id", "name", "position", "character", "range_raw"]

# Fields we would like but can live without; reported, never fatal.
OPTIONAL = [
    "sectors_raw",
    "tower_height_m",
    "light_height_m",
    "radar_beacon",
    "ais",
    "history",
    "photos",
]


def present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (str, list, dict)):
        return len(value) > 0
    return True


def bar(n: int, total: int, width: int = 24) -> str:
    filled = round(width * n / total) if total else 0
    return "█" * filled + "·" * (width - filled)


def main() -> int:
    if not DATA_FILE.exists():
        print("No lighthouses.json — run build_dataset.py first.")
        return 1

    data: list[dict[str, Any]] = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    total = len(data)
    failures: list[str] = []

    print(f"\n{'=' * 78}\nDATASET COVERAGE — {total} stations\n{'=' * 78}\n")

    # --- 1. field coverage --------------------------------------------------
    print("REQUIRED")
    for field in REQUIRED:
        have = [s for s in data if present(s.get(field))]
        missing = [s["id"] for s in data if not present(s.get(field))]
        flag = "" if len(have) == total else "  <-- FAILS"
        print(f"  {field:<18}{bar(len(have), total)} {len(have):>3}/{total}{flag}")
        if missing:
            failures.append(f"{field} missing on: {', '.join(missing)}")

    print("\nOPTIONAL")
    for field in OPTIONAL:
        have = [s for s in data if present(s.get(field))]
        missing = [s["id"] for s in data if not present(s.get(field))]
        print(f"  {field:<18}{bar(len(have), total)} {len(have):>3}/{total}")
        if missing and len(missing) <= 6:
            print(f"  {'':<18}missing: {', '.join(missing)}")

    # --- 2. payload budget --------------------------------------------------
    total_bytes = DATA_FILE.stat().st_size
    history_bytes = sum(len(json.dumps(s.get("history") or "")) for s in data)
    photo_bytes = sum(len(json.dumps(s.get("photos") or [])) for s in data)

    print(f"\n{'-' * 78}\nPAYLOAD — this JSON ships to the browser\n{'-' * 78}")
    print(f"  total                {total_bytes / 1024:>7.0f} KiB")
    print(
        f"  of which history     {history_bytes / 1024:>7.0f} KiB"
        f"   ({100 * history_bytes / total_bytes:.0f}%)"
    )
    print(f"  of which photo URLs  {photo_bytes / 1024:>7.0f} KiB")
    if history_bytes / total_bytes > 0.5:
        print(
            "\n  NOTE: history prose dominates the payload but is only read once a\n"
            "  station is opened. Splitting it into a lazily-fetched file would cut\n"
            f"  first load to roughly {(total_bytes - history_bytes) / 1024:.0f} KiB."
        )

    # --- 3. review flags ----------------------------------------------------
    print(f"\n{'-' * 78}\nREVIEW FLAGS\n{'-' * 78}")

    drifted = [s for s in data if (s["position"].get("cross_check_delta_m") or 0) > 50]
    print(f"\n  positions where the page's two sources disagree by >50 m: {len(drifted)}")
    for s in drifted:
        print(f"      {s['id']}: {s['position']['cross_check_delta_m']:.0f} m")

    unparsed = [
        s
        for s in data
        if s.get("sectors_raw")
        and s["sectors_raw"].strip().lower() != "none"
        and not s.get("sectors")
    ]
    print(f"\n  sector text present but unparsed: {len(unparsed)}")
    for s in unparsed:
        print(f"      {s['id']}: {s['sectors_raw'][:70]}")

    no_range = [s for s in data if not s.get("ranges")]
    print(f"\n  range text present but unparsed: {len(no_range)}")
    for s in no_range:
        print(f"      {s['id']}: {s['range_raw'][:70]}")

    evidence = Counter(s["tower"].get("evidence", "default") for s in data)
    print("\n  tower profiles by evidence:")
    for kind, label in (
        ("photo", "read from the station's own photographs — a likeness"),
        ("generic", "no usable photograph; neutral tower, labelled in the UI"),
        ("default", "no override authored; height-derived, labelled in the UI"),
    ):
        n = evidence.get(kind, 0)
        if n:
            print(f"      {kind:<10}{n:>3}/{total}  {label}")
    for s in data:
        if s["tower"].get("evidence") != "photo":
            print(f"        {s['tower'].get('evidence')}: {s['id']}")

    # --- summary ------------------------------------------------------------
    arcs = Counter(a["kind"] for s in data for a in s.get("sectors", []))
    coasts = Counter(s["coast"] for s in data)
    print(f"\n{'-' * 78}\nSHAPE\n{'-' * 78}")
    print(f"  arcs by kind: {dict(arcs)}")
    print(f"  coasts:       {dict(coasts)}")
    print(f"  distinct character strings: {len({s['character']['raw'] for s in data})}")

    print(f"\n{'=' * 78}")
    if failures:
        print("FAILED — required fields missing:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS — every required field is present on every station.")
    print(f"{'=' * 78}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
