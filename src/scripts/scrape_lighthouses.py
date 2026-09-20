"""Scrape Irish Lights lighthouse pages into a local HTML cache.

Stage 1 of the data pipeline. This script does exactly one thing: put the raw HTML on
disk. No parsing, no normalisation. That separation is deliberate — parsing is the part
we will iterate on dozens of times, and it must never require touching the network again.

Conduct: one request at a time, a delay between requests, a descriptive User-Agent, and
a cache check before every fetch. The site gets hit once, not once per debugging run.
Re-fetch explicitly with --refresh.

    uv run src/scripts/scrape_lighthouses.py
    uv run src/scripts/scrape_lighthouses.py --refresh
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from selectolax.parser import HTMLParser

BASE = "https://www.irishlights.ie"
INDEX_URL = f"{BASE}/tourism/our-lighthouses/lighthouse-list.aspx"

# Index pages that live in the same directory but are not stations.
NOT_A_STATION = {"lighthouse-list", "our-lighthouses"}

USER_AGENT = (
    "great-irish-lighthouses/0.1 (educational lighthouse map project; "
    "contact via github; respects robots.txt)"
)
REQUEST_DELAY_S = 1.0
TIMEOUT_S = 30.0

RAW_DIR = Path(__file__).parent / "raw"
STATIONS_DIR = RAW_DIR / "stations"
INDEX_FILE = RAW_DIR / "index.html"
MANIFEST_FILE = RAW_DIR / "manifest.json"


@dataclass
class StationRef:
    """A station discovered on the index page, before any content is parsed."""

    slug: str  # canonical id, e.g. "black-head-antrim"
    name: str  # link text, e.g. "Black Head (Antrim)"
    url: str  # absolute URL
    file: str  # cache filename relative to raw/stations/


def slugify(raw: str) -> str:
    """Normalise a URL stem into a stable id.

    Source slugs are messy — `black-head-(antrim)`, `st-john's-point-(down)`,
    `rathlin-obirne`. Parentheses and apostrophes are hostile in filenames, URLs and
    JS object keys alike, so we strip them once here and use the result everywhere
    downstream as the station's permanent id.
    """
    s = raw.lower()
    s = s.replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def discover_stations(index_html: str) -> list[StationRef]:
    """Pull every station link out of the index page."""
    tree = HTMLParser(index_html)
    seen: dict[str, StationRef] = {}

    for node in tree.css("a[href]"):
        href = (node.attributes.get("href") or "").strip()
        if "/our-lighthouses/" not in href.lower() or not href.lower().endswith(".aspx"):
            continue

        url = urljoin(INDEX_URL, href)
        stem = Path(urlsplit(url).path).stem
        slug = slugify(stem)
        if not slug or slug in NOT_A_STATION:
            continue

        name = " ".join(node.text(strip=True).split())
        if not name:
            continue

        # Same station can be linked more than once; first occurrence wins.
        seen.setdefault(slug, StationRef(slug=slug, name=name, url=url, file=f"{slug}.html"))

    return sorted(seen.values(), key=lambda s: s.slug)


def fetch(client: httpx.Client, url: str) -> str:
    response = client.get(url)
    response.raise_for_status()
    return response.text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="re-fetch pages that are already cached",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="only fetch the first N stations (for a quick smoke test)",
    )
    args = parser.parse_args()

    STATIONS_DIR.mkdir(parents=True, exist_ok=True)

    with httpx.Client(
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT_S,
        follow_redirects=True,
    ) as client:
        # --- index -------------------------------------------------------------
        if INDEX_FILE.exists() and not args.refresh:
            print(f"index   cached   {INDEX_FILE.relative_to(RAW_DIR.parent)}")
            index_html = INDEX_FILE.read_text(encoding="utf-8")
        else:
            print(f"index   fetching {INDEX_URL}")
            try:
                index_html = fetch(client, INDEX_URL)
            except httpx.HTTPError as exc:
                print(f"FATAL: could not fetch the index page: {exc}", file=sys.stderr)
                return 1
            INDEX_FILE.write_text(index_html, encoding="utf-8")
            time.sleep(REQUEST_DELAY_S)

        stations = discover_stations(index_html)
        if not stations:
            print(
                "FATAL: no station links found on the index page.\n"
                "The markup has probably changed — inspect raw/index.html.",
                file=sys.stderr,
            )
            return 1

        print(f"\ndiscovered {len(stations)} stations on the index page")
        if args.limit:
            stations = stations[: args.limit]
            print(f"--limit {args.limit}: fetching the first {len(stations)}")
        print()

        # --- stations ----------------------------------------------------------
        fetched = cached = failed = 0
        failures: list[tuple[str, str]] = []

        for i, station in enumerate(stations, 1):
            target = STATIONS_DIR / station.file
            prefix = f"[{i:>3}/{len(stations)}] {station.slug:<32}"

            if target.exists() and not args.refresh:
                print(f"{prefix} cached")
                cached += 1
                continue

            try:
                html = fetch(client, station.url)
            except httpx.HTTPError as exc:
                # Keep going: one dead page should not cost us the whole run.
                print(f"{prefix} FAILED  {exc}")
                failures.append((station.slug, str(exc)))
                failed += 1
                time.sleep(REQUEST_DELAY_S)
                continue

            target.write_text(html, encoding="utf-8")
            print(f"{prefix} fetched  {len(html) // 1024} KiB")
            fetched += 1
            time.sleep(REQUEST_DELAY_S)

    MANIFEST_FILE.write_text(
        json.dumps([asdict(s) for s in stations], indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"\nfetched {fetched} · cached {cached} · failed {failed}")
    print(f"manifest -> {MANIFEST_FILE}")
    if failures:
        print("\nfailures:", file=sys.stderr)
        for slug, err in failures:
            print(f"  {slug}: {err}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
