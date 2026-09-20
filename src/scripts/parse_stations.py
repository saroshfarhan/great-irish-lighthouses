"""Parse cached Irish Lights station HTML into structured records.

Stage 2 of the pipeline. Reads only from `raw/` — never the network — so this can be
run as often as we like while iterating on the extraction rules.

The source pages give us two independent positions:

  1. a DMS string in the spec table  -- "51°23.358' North 09°36.178' West"
  2. a decimal pair in the Google Maps JS -- LatLng(51.3893,-9.60297)

We parse both and **cross-check them**. They should agree to within a few metres; where
they don't, one of them is wrong and we want to know which stations are affected rather
than silently picking a winner. This is the main reason the parser is worth its length.

Philosophy: fail loudly per field. A missing value becomes an explicit `None` plus an
entry in `parse_issues`, never a silently-dropped record. `report_coverage.py` then
turns those issues into a table we can actually act on.

    uv run src/scripts/parse_stations.py
    uv run src/scripts/parse_stations.py --station fastnet
"""

from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
from selectolax.parser import HTMLParser

RAW_DIR = Path(__file__).parent / "raw"
STATIONS_DIR = RAW_DIR / "stations"
MANIFEST_FILE = RAW_DIR / "manifest.json"
PARSED_FILE = RAW_DIR / "parsed.json"

MEDIA_BASE = "https://www.irishlights.ie"

# The spec-table labels we understand, mapped to record field names. Anything else the
# page offers is preserved verbatim in `extra_fields` so we notice new labels appearing.
FIELD_LABELS = {
    "position": "position_text",
    "sectors": "sectors",
    "height of tower": "height_of_tower_text",
    "height of light mhws": "height_of_light_text",
    "character": "character_text",
    "range": "range_text",
    "radar beacon": "radar_beacon",
    "ais": "ais",
}

# Only the marker position, not the map's initial centre (which is a hardcoded
# LatLng(57.8, 14.0) somewhere over Sweden and would quietly poison the dataset).
MARKER_LATLNG_RE = re.compile(
    r"position\s*:\s*new\s+google\.maps\.LatLng\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)"
)

# "51°23.358' North 09°36.178' West" and its many small variations.
DMS_RE = re.compile(
    r"(?P<deg>\d{1,3})\s*[°º]\s*"
    r"(?P<min>\d{1,2}(?:\.\d+)?)\s*['′’]?\s*"
    r"(?:(?P<sec>\d{1,2}(?:\.\d+)?)\s*[\"″]\s*)?"
    r"(?P<hemi>North|South|East|West|[NSEW])\b",
    re.IGNORECASE,
)

YEAR_RE = re.compile(r"\b(1[5-9]\d{2}|20[0-2]\d)\b")

# Ireland, generously bounded. A station outside this is a parse error, not a lighthouse.
IRELAND_BBOX = (-11.0, 51.0, -5.0, 56.0)  # lon_min, lat_min, lon_max, lat_max

# Positions disagreeing by more than this are reported for manual review.
POSITION_TOLERANCE_M = 150.0


class Station(BaseModel):
    """One lighthouse as the source describes it, before normalisation."""

    slug: str
    name: str
    url: str

    # --- position -----------------------------------------------------------
    position_text: str | None = None
    lat_dms: float | None = None
    lon_dms: float | None = None
    lat_js: float | None = None
    lon_js: float | None = None
    position_delta_m: float | None = None

    # --- aids to navigation, verbatim from the table ------------------------
    character_text: str | None = None
    sectors: str | None = None
    range_text: str | None = None
    height_of_tower_text: str | None = None
    height_of_light_text: str | None = None
    radar_beacon: str | None = None
    ais: str | None = None

    # --- prose and media ----------------------------------------------------
    history: str | None = None
    years_mentioned: list[int] = Field(default_factory=list)
    photos: list[str] = Field(default_factory=list)

    # --- provenance ---------------------------------------------------------
    extra_fields: dict[str, str] = Field(default_factory=dict)
    parse_issues: list[str] = Field(default_factory=list)


def clean(text: str) -> str:
    """Collapse whitespace, including the non-breaking spaces this CMS is fond of."""
    text = unicodedata.normalize("NFKC", text)
    return " ".join(text.split()).strip()


def dms_to_decimal(deg: str, minutes: str, seconds: str | None, hemi: str) -> float:
    value = float(deg) + float(minutes) / 60.0
    if seconds:
        value += float(seconds) / 3600.0
    if hemi[0].upper() in ("S", "W"):
        value = -value
    return value


def parse_position_text(text: str) -> tuple[float | None, float | None, str | None]:
    """Extract (lat, lon) from a DMS position string.

    Returns an error message in the third slot rather than raising, so one malformed
    position doesn't abort the run.
    """
    matches = list(DMS_RE.finditer(text))
    if len(matches) < 2:
        return None, None, f"could not find two DMS coordinates in {text!r}"

    lat = lon = None
    for m in matches[:2]:
        value = dms_to_decimal(m["deg"], m["min"], m["sec"], m["hemi"])
        if m["hemi"][0].upper() in ("N", "S"):
            lat = value
        else:
            lon = value

    if lat is None or lon is None:
        return None, None, f"position {text!r} did not yield one latitude and one longitude"
    return lat, lon, None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def extract_spec_table(tree: HTMLParser) -> tuple[dict[str, str], dict[str, str]]:
    """Pull the two-column label/value spec table.

    Layout is `<tr><td><strong>Label:</strong></td><td>Value</td></tr>`, with occasional
    full-width `<h2>` section headers interleaved that we skip.
    """
    known: dict[str, str] = {}
    extra: dict[str, str] = {}

    for row in tree.css("table tr"):
        cells = row.css("td")
        if len(cells) < 2:
            continue  # section header row

        label = clean(cells[0].text()).rstrip(":").strip()
        value = clean(cells[1].text())
        if not label or not value:
            continue

        key = label.lower()
        if key in FIELD_LABELS:
            known[FIELD_LABELS[key]] = value
        else:
            extra[label] = value

    return known, extra


def parse_station(slug: str, name: str, url: str, html: str) -> Station:
    tree = HTMLParser(html)
    issues: list[str] = []

    # --- name, preferring the page's own <h1> -------------------------------
    h1 = tree.css_first("h1")
    if h1:
        heading = clean(h1.text())
        heading = re.sub(r"\s+Lighthouse$", "", heading, flags=re.IGNORECASE)
        if heading:
            name = heading
    else:
        issues.append("no <h1> on the page; falling back to the index link text")

    # --- spec table ---------------------------------------------------------
    known, extra = extract_spec_table(tree)
    if not known:
        issues.append("spec table not found or unrecognised — markup may have changed")

    station = Station(slug=slug, name=name, url=url, extra_fields=extra, **known)

    # --- positions, from two independent sources ----------------------------
    if station.position_text:
        lat, lon, err = parse_position_text(station.position_text)
        station.lat_dms, station.lon_dms = lat, lon
        if err:
            issues.append(err)
    else:
        issues.append("no Position field in the spec table")

    if m := MARKER_LATLNG_RE.search(html):
        station.lat_js, station.lon_js = float(m[1]), float(m[2])
    else:
        issues.append("no marker LatLng in the page JavaScript")

    if None not in (station.lat_dms, station.lon_dms, station.lat_js, station.lon_js):
        delta = haversine_m(station.lat_dms, station.lon_dms, station.lat_js, station.lon_js)
        station.position_delta_m = round(delta, 1)
        if delta > POSITION_TOLERANCE_M:
            issues.append(
                f"DMS and JS positions disagree by {delta:.0f} m "
                f"(table {station.lat_dms:.5f},{station.lon_dms:.5f} vs "
                f"js {station.lat_js:.5f},{station.lon_js:.5f})"
            )

    lon_min, lat_min, lon_max, lat_max = IRELAND_BBOX
    for source, lat, lon in (
        ("table", station.lat_dms, station.lon_dms),
        ("js", station.lat_js, station.lon_js),
    ):
        if lat is None or lon is None:
            continue
        if not (lat_min <= lat <= lat_max and lon_min <= lon <= lon_max):
            issues.append(f"{source} position {lat:.4f},{lon:.4f} falls outside Ireland")

    # --- history prose ------------------------------------------------------
    article = tree.css_first("article")
    if article:
        history = clean(article.text())
        station.history = history or None
        station.years_mentioned = sorted({int(y) for y in YEAR_RE.findall(history)})
    if not station.history:
        issues.append("no history prose found")

    # --- photos -------------------------------------------------------------
    photos = {
        src
        for src in re.findall(r'src="(/media/[^"]+)"', html)
        if "_MainImage" in src  # station photography; the rest are site chrome
    }
    station.photos = sorted(MEDIA_BASE + p for p in photos)
    if not station.photos:
        issues.append("no station photographs found")

    station.parse_issues = issues
    return station


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--station", help="parse a single slug and print it (for debugging)")
    args = ap.parse_args()

    if not MANIFEST_FILE.exists():
        print("No manifest — run scrape_lighthouses.py first.")
        return 1

    manifest: list[dict[str, Any]] = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    if args.station:
        manifest = [m for m in manifest if m["slug"] == args.station]
        if not manifest:
            print(f"No station with slug {args.station!r}")
            return 1

    stations: list[Station] = []
    for entry in manifest:
        path = STATIONS_DIR / entry["file"]
        if not path.exists():
            print(f"  {entry['slug']}: no cached HTML, skipping")
            continue
        stations.append(
            parse_station(
                slug=entry["slug"],
                name=entry["name"],
                url=entry["url"],
                html=path.read_text(encoding="utf-8"),
            )
        )

    if args.station:
        print(stations[0].model_dump_json(indent=2))
        return 0

    PARSED_FILE.write_text(
        json.dumps([s.model_dump() for s in stations], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    with_issues = [s for s in stations if s.parse_issues]
    print(f"parsed {len(stations)} stations -> {PARSED_FILE.relative_to(RAW_DIR.parent)}")
    print(f"{len(stations) - len(with_issues)} clean · {len(with_issues)} with issues\n")

    for s in with_issues:
        print(f"  {s.slug}")
        for issue in s.parse_issues:
            print(f"      - {issue}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
