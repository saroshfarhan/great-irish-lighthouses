"""Normalise parsed stations into the dataset the web app consumes.

Stage 3 of the pipeline: `raw/parsed.json` + `tower-overrides.json` -> `src/data/lighthouses.json`.

Scope discipline — the one thing to understand before editing this file:

    This script does NOT interpret light characters.

`character.raw` is copied through verbatim. Turning `"Fl (2) W 20s. Auxiliary Light..."`
into a flash timeline happens exactly once, in TypeScript (`src/lib/character/`), because
that parser is needed at runtime and a second copy here would silently diverge from it.
See "Rules that must not be broken" in CLAUDE.md.

What this script *does* do is mechanical normalisation that carries no semantics:
degrees to decimals, "54 metres" to 54, splitting per-colour ranges, and merging the
hand-authored visual attributes used by the 3D generator.

    uv run src/scripts/build_dataset.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

SCRIPTS_DIR = Path(__file__).parent
PARSED_FILE = SCRIPTS_DIR / "raw" / "parsed.json"
DATA_DIR = SCRIPTS_DIR.parent / "data"
OVERRIDES_FILE = DATA_DIR / "tower-overrides.json"
OUTPUT_FILE = DATA_DIR / "lighthouses.json"

# History prose is 74% of the payload and is not read until a station is opened, so it
# ships as a separate lazily-fetched file. `lighthouses.json` carries only `has_history`.
HISTORIES_FILE = DATA_DIR / "histories.json"

METRES_RE = re.compile(r"(\d+(?:\.\d+)?)\s*m(?:etre|eter)?s?\b", re.IGNORECASE)

# "White 16 nautical miles" / "W 20 nautical miles" / "Red 11 nm" / "White: 8 nautical miles"
RANGE_RE = re.compile(
    r"(?P<label>White|Red|Green|Yellow|W|R|G|Y)\b"
    r"(?P<qualifier>\s*\((?:[^)]*)\))?"
    r"\s*[:=]?\s*"
    r"(?P<value>\d+(?:\.\d+)?)\s*(?:nautical\s*miles?|nm|n\.m\.)",
    re.IGNORECASE,
)
# A bare "18 nautical miles" with no colour named at all.
BARE_RANGE_RE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)\s*(?:nautical\s*miles?|nm)\b", re.IGNORECASE)

# An arc of bearings, in any of the forms the source uses:
#   "R262°-281° (19°)"  "R066°-shore"  "shore-292°"  "Vis 296-324 (28)"  "011.3°-016.6°"
# Colour and kind are read from the text immediately preceding each match, because the
# source writes them inconsistently ("W Vis", "Red Visibile", "Obscured by land", "+ Aux R Vis").
ARC_RE = re.compile(
    r"(?P<from>\d{1,3}(?:\.\d+)?|shore)\s*[°º]?"
    r"\s*[-–]\s*"
    r"(?P<to>\d{1,3}(?:\.\d+)?|shore)\s*[°º]?"
    r"(?:\s*\(\s*(?P<width>\d{1,3}(?:\.\d+)?)\s*[°º]?\s*\))?",
    re.IGNORECASE,
)
ALL_ROUND_RE = re.compile(r"^\s*360\s*[°º]?\s*\.?\s*$")
COLOUR_TOKEN_RE = re.compile(r"\b(White|Red|Green|Yellow|W|R|G|Y)\b")
QUALIFIER_RE = re.compile(r"\(([^)]*)\)\s*$")

COLOUR_NAMES = {
    "w": "white",
    "white": "white",
    "r": "red",
    "red": "red",
    "g": "green",
    "green": "green",
    "y": "yellow",
    "yellow": "yellow",
}


# Coarse coast assignment, used for the map's region filter. The source has no county
# field, but coast is derivable from position and is the more useful filter for a map
# of navigational aids anyway.
def coast_of(lat: float, lon: float) -> str:
    if lat >= 54.6 and lon <= -6.0:
        return "north"
    if lon >= -6.6:
        return "east"
    if lat <= 52.2:
        return "south"
    if lon <= -9.0:
        return "west"
    return "south" if lat < 53.3 else "west"


class Position(BaseModel):
    lat: float
    lon: float
    raw: str
    """The published DMS string, kept for display — chart annotation, not decimals."""
    cross_check_delta_m: float | None = None
    """Distance between the two independent sources on the page. Should be ~0."""


class LightCharacter(BaseModel):
    raw: str
    """Verbatim from the source. Interpreted in TypeScript, never here."""


class LightRange(BaseModel):
    colour: str | None
    nautical_miles: float
    qualifier: str | None = None


class Arc(BaseModel):
    """One arc of bearings from the source's "Sectors" field.

    That field conflates three genuinely different things, so each arc is tagged:

      sector      a coloured sector — the light shows this colour over this arc
      visibility  the arc over which the light is visible at all (single-colour lights)
      obscured    an arc where land blocks the light

    Rendering them identically would tell the viewer that Galley Head is a sectored
    light, which it is not — it is one white light visible over 256°-065°.
    """

    kind: str
    colour: str | None = None
    from_deg: float | None = None
    to_deg: float | None = None
    from_shore: bool = False
    to_shore: bool = False
    width_deg: float | None = None
    qualifier: str | None = None


class Band(BaseModel):
    """A painted band, as a fraction of tower height from the base."""

    colour: str
    from_frac: float
    to_frac: float


class Tower(BaseModel):
    """Visual attributes for the 3D generator.

    None of this is published as structured data, so it is hand-authored in
    `tower-overrides.json` from the station's own photographs. `evidence` records how
    each entry was arrived at, so the coverage report can distinguish a tower we have
    actually seen from one we inferred.

    shape:
      tapered      classic coastal tower, noticeably conical
      cylindrical  straight-sided
      conical      squat harbour light
      square       square granite tower (Blacksod)
      caisson      offshore concrete caisson (Kish Bank)
      lattice      steel lattice mast (Corlis Point Rear)
      box          modern flat-roofed equipment structure
    """

    shape: str = "tapered"
    body_colour: str = "#e9e5dc"
    bands: list[Band] = Field(default_factory=list)
    lantern_colour: str = "#1b1c20"
    gallery_colour: str = "#a8332c"
    galleries: int = 1
    has_dwelling: bool = False
    is_default: bool = True
    evidence: str = "default"
    """How this profile was arrived at, and whether the UI should caveat it.

    photo   — read from the station's own photographs; render as accurate.
    generic — photographs showed no usable elevation, so this is a deliberately
              neutral tower. The UI MUST label it as not a likeness.
    default — no override authored at all; height-derived fallback. Also labelled.

    Anything other than `photo` is a representation, not a likeness. Never invent a
    plausible paint scheme to fill a gap: a confident-looking wrong tower is worse
    than an honest generic one."""


class Lighthouse(BaseModel):
    id: str
    name: str
    source_url: str
    coast: str

    position: Position
    character: LightCharacter
    sectors_raw: str | None = None
    sectors: list[Arc] = Field(default_factory=list)

    range_raw: str
    ranges: list[LightRange] = Field(default_factory=list)

    tower_height_m: float | None = None
    light_height_m: float | None = None

    radar_beacon: str | None = None
    ais: str | None = None

    has_history: bool = False
    """History prose lives in histories.json, fetched when the drawer opens."""
    photos: list[str] = Field(default_factory=list)

    tower: Tower = Field(default_factory=Tower)

    data_notes: list[str] = Field(default_factory=list)
    """Per-station provenance: what we could not derive and why."""


def parse_metres(text: str | None) -> float | None:
    if not text:
        return None
    m = METRES_RE.search(text)
    return float(m[1]) if m else None


def parse_ranges(text: str | None) -> tuple[list[LightRange], str | None]:
    """Split a range string into per-colour figures.

    Formats in the wild: "18 nautical miles", "White 16 nautical miles, Red 11 nautical
    miles", "W17 nautical miles.", "White 13nm, Red 11 nm", "White: 8 nautical miles".
    """
    if not text:
        return [], "no range given"

    ranges = [
        LightRange(
            colour=COLOUR_NAMES.get(m["label"].lower()),
            nautical_miles=float(m["value"]),
            qualifier=m["qualifier"].strip(" ()") if m["qualifier"] else None,
        )
        for m in RANGE_RE.finditer(text)
    ]
    if ranges:
        return ranges, None

    # No colour named — a single-colour light quoting one figure.
    if m := BARE_RANGE_RE.search(text):
        return [LightRange(colour=None, nautical_miles=float(m[1]))], None

    return [], f"could not parse any range from {text!r}"


def classify_arc(preamble: str) -> tuple[str, str | None]:
    """Read the kind and colour of an arc from the text that precedes it.

    The source writes this prefix freely — "W Vis", "Red Visibile" (sic), "R(intens)",
    "Obscured by land", "+ Aux R Vis" — so we look at the text since the last separator
    rather than trying to match one rigid shape.
    """
    tail = re.split(r"[,.;+]", preamble)[-1]
    low = tail.lower()

    if "obscur" in low:
        kind = "obscured"
    elif "vis" in low:  # covers Vis, Visible, and the site's "Visibile" typo
        kind = "visibility"
    else:
        kind = "sector"

    colour = None
    if m := COLOUR_TOKEN_RE.search(tail):
        colour = COLOUR_NAMES.get(m[1].lower())

    return kind, colour


def parse_sectors(text: str | None) -> tuple[list[Arc], str | None]:
    """Best-effort split of the "Sectors" field into classified arcs.

    These are freeform bearing descriptions written for mariners, not for parsers
    ("Obscured by land 234°-007° (133°) and bearing 013°"). We extract what matches
    cleanly and always keep the raw text so the drawer can fall back to showing it.
    """
    if not text or text.strip().lower() in ("none", "n/a", "-"):
        return [], None

    if ALL_ROUND_RE.match(text):
        return [Arc(kind="visibility", from_deg=0.0, to_deg=360.0, width_deg=360.0)], None

    arcs: list[Arc] = []
    cursor = 0
    for m in ARC_RE.finditer(text):
        kind, colour = classify_arc(text[cursor : m.start()])
        cursor = m.end()

        frm, to = m["from"].lower(), m["to"].lower()
        qualifier = None
        if q := QUALIFIER_RE.search(text[: m.start()].rstrip()):
            qualifier = q[1].strip() or None

        arcs.append(
            Arc(
                kind=kind,
                colour=colour,
                from_deg=None if frm == "shore" else float(frm),
                to_deg=None if to == "shore" else float(to),
                from_shore=frm == "shore",
                to_shore=to == "shore",
                width_deg=float(m["width"]) if m["width"] else None,
                qualifier=qualifier,
            )
        )

    if not arcs:
        return [], f"sector text present but unparsed: {text[:80]!r}"
    return arcs, None


def default_tower(height_m: float | None) -> Tower:
    """A plausible tower when no override exists, scaled by published height."""
    h = height_m or 15.0
    if h >= 30:
        shape = "tapered"  # tall coastal towers taper noticeably
    elif h >= 12:
        shape = "cylindrical"
    else:
        shape = "conical"  # squat harbour lights
    return Tower(shape=shape, galleries=1, is_default=True, evidence="default")


def build() -> int:
    if not PARSED_FILE.exists():
        print("No parsed.json — run parse_stations.py first.")
        return 1

    parsed = json.loads(PARSED_FILE.read_text(encoding="utf-8"))
    overrides: dict[str, Any] = {}
    if OVERRIDES_FILE.exists():
        raw_overrides = json.loads(OVERRIDES_FILE.read_text(encoding="utf-8"))
        # Keys beginning with "_" are documentation, not stations.
        overrides = {k: v for k, v in raw_overrides.items() if not k.startswith("_")}

        unknown = set(overrides) - {s["slug"] for s in parsed}
        for slug in sorted(unknown):
            print(f"  WARNING: override for unknown station {slug!r} — typo in the id?")

    out: list[Lighthouse] = []
    for s in parsed:
        notes: list[str] = list(s.get("parse_issues") or [])

        lat, lon = s["lat_dms"], s["lon_dms"]
        if lat is None or lon is None:
            lat, lon = s["lat_js"], s["lon_js"]
            notes.append("fell back to the JavaScript position; DMS was unusable")
        if lat is None or lon is None:
            notes.append("NO POSITION — station skipped")
            print(f"  SKIP {s['slug']}: no usable position")
            continue

        ranges, range_note = parse_ranges(s.get("range_text"))
        if range_note:
            notes.append(range_note)

        sectors, sector_note = parse_sectors(s.get("sectors"))
        if sector_note:
            notes.append(sector_note)

        tower_h = parse_metres(s.get("height_of_tower_text"))
        if tower_h is None:
            notes.append("no tower height published")

        # No "established" field: the year appears only in prose, and the first year
        # there is frequently an *earlier* light on a different site (Fastnet's text
        # opens with 1818, but the tower dates from 1854). Deriving it by rule would
        # manufacture a fact, so the history text speaks for itself instead.

        override = overrides.get(s["slug"])
        tower = Tower(**{**override, "is_default": False}) if override else default_tower(tower_h)

        out.append(
            Lighthouse(
                id=s["slug"],
                name=s["name"],
                source_url=s["url"],
                coast=coast_of(lat, lon),
                position=Position(
                    lat=round(lat, 6),
                    lon=round(lon, 6),
                    raw=s["position_text"],
                    cross_check_delta_m=s.get("position_delta_m"),
                ),
                character=LightCharacter(raw=s["character_text"]),
                sectors_raw=s.get("sectors"),
                sectors=sectors,
                range_raw=s.get("range_text") or "",
                ranges=ranges,
                tower_height_m=tower_h,
                light_height_m=parse_metres(s.get("height_of_light_text")),
                radar_beacon=s.get("radar_beacon"),
                ais=s.get("ais"),
                has_history=bool(s.get("history")),
                photos=s.get("photos") or [],
                tower=tower,
                data_notes=notes,
            )
        )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(
        json.dumps([lh.model_dump() for lh in out], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    histories = {s["slug"]: s["history"] for s in parsed if s.get("history")}
    HISTORIES_FILE.write_text(
        json.dumps(histories, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    size_kb = OUTPUT_FILE.stat().st_size / 1024
    hist_kb = HISTORIES_FILE.stat().st_size / 1024
    print(f"wrote {len(out)} lighthouses -> {OUTPUT_FILE} ({size_kb:.0f} KiB, ships on load)")
    print(f"wrote {len(histories)} histories  -> {HISTORIES_FILE} ({hist_kb:.0f} KiB, lazy)")
    print(f"  with sectors parsed: {sum(1 for lh in out if lh.sectors)}")
    print(f"  with ranges parsed:  {sum(1 for lh in out if lh.ranges)}")
    print(f"  using default tower: {sum(1 for lh in out if lh.tower.is_default)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(build())
