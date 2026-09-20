# Great Irish Lighthouses

**Every lighthouse on the Irish coast, sweeping in its own real rhythm.**

An interactive chart of the 65 stations operated by the Commissioners of Irish Lights. Each
light turns at its true published period, throws the right number of beams, and reaches as far
as its published range. Click one and you descend to a three-dimensional tower built from that
station's own recorded height and paint scheme.

<!-- Add a screenshot here: the whole coast sweeping at 60×. -->

---

## Why lighthouses

There is a particular kind of wonder in a lighthouse.

It is a machine with one sentence to say, and it says it the same way every night for a
hundred and fifty years. *Three flashes, then wait fifteen seconds.* That sentence is not
decoration — it is the light's **name**. A mariner off a dark coast with no instruments at all
can count flashes against a watch and know exactly where they are, because no two neighbouring
lights ever say the same thing. Hook Head says `Fl W 3s`. Fastnet says `Fl W 5s`. Tory Island
takes a full half-minute to say `Fl (4) W 30s`.

It is one of the oldest data protocols in the world, and it is transmitted by turning a lens.

That is what this project is about. Not a map with dots on it — a map where you can **read the
rhythms**, compare them, and see the pattern that lets a whole coastline identify itself in the
dark.

---

## Ireland and its lights

Ireland is unusually rich in lighthouse history, and unusually good at looking after it.

**Hook Head** has been showing a light from the same tower since around **1245**, when the
Earl of Pembroke's tower took over from a beacon that monks had tended before him. It is among
the oldest operational lighthouses anywhere in the world. It is still working. It is still in
this dataset, still flashing `Fl W 3s`, and you can open it in this app and watch it turn.

The service that keeps it lit traces to the **Ballast Board of 1786**, and today the
**Commissioners of Irish Lights** are a genuine rarity: a single authority for aids to
navigation across the **entire island**, operating seamlessly in both jurisdictions, north and
south, without interruption. Few maritime nations can say the same.

And the technology has never stood still. From the data in this repository:

- **Every station is automated.** The last keepers in Ireland were withdrawn from **Baily on
  24 March 1997** — in Irish Lights' own words, *"Baily was the last Irish Lighthouse to be
  unwatched."* An eight-hundred-year manned tradition closed on a specific afternoon.
- **36 of the 65 stations carry AIS**, broadcasting their identity digitally as well as
  optically.
- **12 carry radar beacons (racons)** — Fastnet answers a ship's radar with Morse 'G', Hook
  Head with 'K' — so the light is visible to instruments even when it is invisible to the eye.
- Several are **directional or sectored**, showing a mariner a different colour depending on
  their bearing: white if you are in safe water, red if you are standing into danger. Roches
  Point alone divides the horizon into five sectors.

A lighthouse is therefore not a relic. It is a beacon that has been continuously re-engineered
for eight centuries and still transmits on the oldest channel there is — light across water —
while simultaneously talking to satellites.

### Credit where it is due

**All lighthouse data and photography in this project belongs to the
[Commissioners of Irish Lights](https://www.irishlights.ie).** Positions, light characters,
ranges, sector bearings, tower heights and the station histories are theirs, published openly
on their website, and scraped here with attribution and gratitude.

Irish Lights has kept these lights burning since 1786 and — unusually for a safety
organisation with no obligation to — publishes the details generously enough that a project
like this can exist. This app is an appreciation of their work, and is **not affiliated with
or endorsed by them**.

> ### ⚠️ Not for navigation
>
> Flash periods, group counts and ranges are reproduced faithfully from published data, but
> the real-world **phase** — which exact second a given flash falls on — is not published and
> is **not** simulated here. Sub-second flash durations follow IALA convention rather than
> measurement. Use official Admiralty publications and Notices to Mariners at sea.

---

## What the app does

**The lights sweep, they do not blink.** A flashing character comes from a rotating optic —
the flash you see is one panel of the lens passing you. So `Fl (3) W 15s` is drawn as three
beams turning once every fifteen seconds, and the flash *emerges from the geometry* rather
than being animated on top of it. Isophase, occulting and fixed lights do not turn, so they
correctly pulse instead.

**Beam length is real range.** Aranmore reaches 27 nautical miles; Ballagh Rocks reaches 5.
You can see the difference on the chart.

**One clock drives everything.** The sweep on the map, the beam on the 3D tower and the
playhead on the character ribbon all read the same function at the same instant, so they can
never disagree about whether a light is lit.

**Every tower is generated from data.** No hand-modelled assets: a silhouette is revolved and
painted from each station's recorded height and paint scheme, which is why Hook Head has its
black bands, St John's Point its black and yellow, and Fastnet its bare grey granite.

**The character ribbon** draws one period as bars with a playhead sweeping across it, so a
rhythm becomes something you can read and compare rather than an abstraction.

---

## The coast, in numbers

Every figure below is computed from the scraped dataset.

| | |
|---|---|
| Stations | **65** — 21 south, 17 west, 14 east, 13 north |
| Distinct light characters | **57** |
| Tallest tower | **Fastnet**, 54 m |
| Shortest | **Corlis Point Front**, 3.9 m |
| Highest light above the sea | **Bull Rock**, 91 m |
| Longest range | **Aranmore**, 27 nautical miles |
| Shortest range | **Ballagh Rocks**, 5 nautical miles |
| Fastest rhythm | **Cromwell Point**, `Fl WR 2s` |
| Slowest | **Tory Island**, `Fl (4) W 30s` |
| Stations with AIS | 36 |
| Stations with a radar beacon | 12 |

---

## Running it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. To test on a phone or tablet on the same network:

```bash
npm run build && npm run preview:lan
```

Any station can be linked directly — [`#/fastnet`](http://localhost:5173/#/fastnet),
`#/hook-head`, `#/tory-island`.

### Rebuilding the dataset

The dataset is generated, never hand-edited. The pipeline runs on Python 3.13 via
[uv](https://docs.astral.sh/uv/):

```bash
uv run src/scripts/scrape_lighthouses.py    # Irish Lights pages -> local HTML cache
uv run src/scripts/parse_stations.py        # cache -> structured records
uv run src/scripts/build_dataset.py         # -> lighthouses.json + histories.json
uv run src/scripts/gen_types.py             # -> TypeScript types
uv run src/scripts/report_coverage.py       # field coverage + review flags
```

The scraper fetches each page once and caches it, so re-parsing never touches the network.

---

## How it is built

**Vite · React 19 · TypeScript (strict) · Tailwind v4 + Sass · MapLibre GL · Three.js**

```
src/
  scripts/      Python pipeline: scrape -> parse -> build -> typegen
  data/         generated dataset + hand-authored tower appearances
  lib/character/  the light-character engine (parse, timeline, sample)
  lib/clock.ts    the single requestAnimationFrame for the whole app
  components/   map, canvas light overlay, drawer, character ribbon
  three/        procedural tower generator, beam, scene
```

Two ideas carry most of the design:

**The character string is a complete specification.** `Fl (3) W 15s` is parsed once into a
phase timeline; everything else is a consumer of that. The parser exists in exactly one place
and is tested against all 65 real published characters, including the awkward ones —
`ISO WR 4s`, `Fl (2)W 15s`, `Fl R 5 s`, `Fl (4) W 30 secs, Night time only`, and Aranmore's
`Fl (2) W 20s. Auxiliary Light Fl R 3s`, which is two lights in one field.

**Never present a representation as a likeness.** 62 towers are modelled from their own
photographs. Three have no usable photograph, so they show a deliberately generic model and
the interface says so. The same instinct produces the "not for navigation" notice and the note
that beam lengths are exaggerated at low zoom.

Engineering notes, architectural rules and the tech-debt register live in
[`CLAUDE.md`](CLAUDE.md).

### Accessibility

The map is a `<canvas>`, so every station is also a real focusable element: tab into the chart
and a station list appears, arrow through it, press Enter to open. Contrast is measured against
WCAG 2.1 AA. Because the blinking *is* the content, `prefers-reduced-motion` holds the lights
steady rather than hiding them, and offers a control to start them.

---

## Credits

- **[Commissioners of Irish Lights](https://www.irishlights.ie)** — all lighthouse data,
  station histories and photography. Keeping the lights since 1786.
- **[CARTO](https://carto.com/basemaps/)** and **[OpenStreetMap](https://www.openstreetmap.org/copyright)**
  contributors — basemap.
- **[MapLibre GL](https://maplibre.org/)**, **[Three.js](https://threejs.org/)** and
  **[React Three Fiber](https://docs.pmnd.rs/react-three-fiber)**.

Lighthouse data and imagery remain © Commissioners of Irish Lights and are used here for
educational, non-commercial purposes.

---

<p align="center">
  <em>“Baily was the last Irish Lighthouse to be unwatched.”</em><br/>
  <sub>— Commissioners of Irish Lights, on the withdrawal of the keepers, 24 March 1997</sub>
</p>
