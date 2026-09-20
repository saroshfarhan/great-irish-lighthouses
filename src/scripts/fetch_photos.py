"""Download and optimise station photographs.

Serves two purposes:

  1. `--contact-sheet` builds small reference images used to hand-author the tower
     profiles in `tower-overrides.json`. The source has no structured field for tower
     shape or paint scheme, so the photographs are the only evidence available.
  2. the default mode produces web-sized WebP for the station drawer.

Photos are cached like the HTML: fetched once, then reused.

    uv run src/scripts/fetch_photos.py --contact-sheet     # small, for authoring
    uv run src/scripts/fetch_photos.py                     # web assets
"""

from __future__ import annotations

import argparse
import io
import json
import time
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont

SCRIPTS_DIR = Path(__file__).parent
DATA_FILE = SCRIPTS_DIR.parent / "data" / "lighthouses.json"
CACHE_DIR = SCRIPTS_DIR / "raw" / "photos"
SHEET_DIR = SCRIPTS_DIR / "raw" / "contact-sheet"
WEB_DIR = SCRIPTS_DIR.parent.parent / "public" / "photos"

USER_AGENT = "great-irish-lighthouses/0.1 (educational lighthouse map project)"
REQUEST_DELAY_S = 0.5

SHEET_WIDTH = 300  # enough to read tower shape and paint banding
WEB_WIDTH = 1200


def download(client: httpx.Client, url: str, dest: Path) -> bytes | None:
    if dest.exists():
        return dest.read_bytes()
    try:
        r = client.get(url)
        r.raise_for_status()
    except httpx.HTTPError as exc:
        print(f"    failed: {exc}")
        return None
    dest.write_bytes(r.content)
    time.sleep(REQUEST_DELAY_S)
    return r.content


def resize(raw: bytes, width: int) -> Image.Image:
    img = Image.open(io.BytesIO(raw))
    img = img.convert("RGB")
    if img.width > width:
        height = round(img.height * width / img.width)
        img = img.resize((width, height), Image.LANCZOS)
    return img


def build_montages(per_row: int = 4, cell: int = 210, stations_per_sheet: int = 9) -> int:
    """Tile the contact sheet into labelled grids, one row per station.

    Grouping by station matters: Irish Lights' photography is a mix of towers, lantern
    interiors, helipads and distant aerials, so a single image per station frequently
    shows no tower at all. A row of that station's photographs almost always contains
    one usable elevation.
    """
    if not DATA_FILE.exists():
        print("No lighthouses.json — run build_dataset.py first.")
        return 1

    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 16)
    except OSError:
        font = ImageFont.load_default()

    label_h = 24
    row_h = cell + label_h
    sheets = 0

    for start in range(0, len(data), stations_per_sheet):
        chunk = data[start : start + stations_per_sheet]
        sheet = Image.new("RGB", (per_row * cell, len(chunk) * row_h), (18, 20, 26))
        draw = ImageDraw.Draw(sheet)

        for r, station in enumerate(chunk):
            y = r * row_h
            draw.text((6, y + 4), station["id"], fill=(214, 168, 88), font=font)

            paths = sorted(SHEET_DIR.glob(f"{station['id']}.jpg")) + sorted(
                SHEET_DIR.glob(f"{station['id']}-*.jpg")
            )
            for c, path in enumerate(paths[:per_row]):
                img = Image.open(path).convert("RGB")
                img.thumbnail((cell, cell - 4), Image.LANCZOS)
                sheet.paste(
                    img,
                    (c * cell + (cell - img.width) // 2, y + label_h + (cell - img.height) // 2),
                )

        out = SHEET_DIR / f"_montage-{sheets + 1}.jpg"
        sheet.save(out, "JPEG", quality=78)
        print(f"  {out.name}: {len(chunk)} stations")
        sheets += 1

    print(f"\nwrote {sheets} montages -> {SHEET_DIR}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--contact-sheet",
        action="store_true",
        help="produce small reference JPEGs for authoring tower profiles",
    )
    ap.add_argument("--per-station", type=int, default=1, help="how many photos per station")
    ap.add_argument(
        "--montage",
        action="store_true",
        help="tile the contact sheet into labelled grids for side-by-side study",
    )
    args = ap.parse_args()

    if args.montage:
        return build_montages()

    if not DATA_FILE.exists():
        print("No lighthouses.json — run build_dataset.py first.")
        return 1

    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    out_dir = SHEET_DIR if args.contact_sheet else WEB_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    width = SHEET_WIDTH if args.contact_sheet else WEB_WIDTH

    written = skipped = 0
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30.0, follow_redirects=True) as c:
        for station in data:
            urls = station["photos"][: args.per_station]
            if not urls:
                skipped += 1
                continue

            for i, url in enumerate(urls):
                stem = station["id"] if i == 0 else f"{station['id']}-{i}"
                cached = CACHE_DIR / f"{stem}{Path(url).suffix or '.jpg'}"

                raw = download(c, url, cached)
                if raw is None:
                    skipped += 1
                    continue

                try:
                    img = resize(raw, width)
                except Exception as exc:  # noqa: BLE001 - a bad image must not stop the run
                    print(f"    {stem}: unreadable image ({exc})")
                    skipped += 1
                    continue

                if args.contact_sheet:
                    img.save(out_dir / f"{stem}.jpg", "JPEG", quality=72)
                else:
                    img.save(out_dir / f"{stem}.webp", "WEBP", quality=80, method=5)
                written += 1

    print(f"\nwrote {written} images -> {out_dir}")
    if skipped:
        print(f"skipped {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
