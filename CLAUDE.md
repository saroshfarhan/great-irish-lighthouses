# Great Irish Lighthouses

A virtual tour of the Commissioners of Irish Lights network: every lighthouse's position on a
dark sea chart, its light blinking in its **real character rhythm**, and a procedural 3D tower
when you fly down to one.

> **Not for navigation.** Periods and flash patterns are accurate; real-world phase (which exact
> second a flash falls on) is not published and is not reproduced. This must stay visible in the UI.

---

## The central idea

Irish Lights publishes each light's *character* as an IALA code — `Fl WR 3s`, `Fl(3) W 15s`,
`Iso W 4s`, `Q(2) W 7.5s`. That string is a complete timing specification.

Parse it **once** into a phase timeline, and a **single clock** drives everything: the blinking dot
on the map, the beam on the 3D tower, and the character ribbon. One source of truth means no
component can drift out of sync with another. Every architectural decision below defends that.

---

## Architecture

Static SPA, no backend. Python builds the data at author time; the app ships pure JSON.

```
CLAUDE.md                     # this file — plan · conventions · TODO · tech debt
pyproject.toml                # uv-managed, Python 3.13
src/
  scripts/                    # Python pipeline (run via `uv run`)
    scrape_lighthouses.py     # index + station pages -> raw/ HTML cache
    parse_stations.py         # HTML -> pydantic models
    build_dataset.py          # merge overrides -> src/data/lighthouses.json
    gen_types.py              # pydantic -> JSON Schema -> src/data/schema.gen.ts
    fetch_photos.py           # station photos -> optimised webp
    report_coverage.py        # per-field completeness table
    raw/                      # gitignored HTML cache
  data/
    lighthouses.json          # GENERATED — never hand-edit
    tower-overrides.json      # hand-authored VISUAL attributes only
    schema.gen.ts             # GENERATED types
  lib/character/              # parse.ts · timeline.ts · sample.ts (+ tests)
  lib/sun.ts  lib/clock.ts    # solar altitude; the single rAF clock
  state/store.ts              # zustand
  components/                 # MapView · LightOverlay · StationPanel · CharacterRibbon
  three/                      # Tower.tsx · buildProfile.ts · Beam.tsx · Scene.tsx
  styles/                     # theme.css (Tailwind @theme) + Sass partials
```

**Python:** `httpx`, `selectolax`, `pydantic` v2.
**Web:** React 19, Tailwind v4, `sass-embedded`, MapLibre GL, Three.js + `@react-three/fiber` +
`@react-three/drei`, `zustand`, `motion`, Vite, TypeScript strict, Vitest.

---

## Rules that must not be broken

These are the load-bearing decisions. Each exists because violating it causes a specific,
predictable bug.

### 1. The character parser lives **only** in TypeScript

It is needed at runtime (TS) and would be *convenient* in Python validation. Two copies would
silently diverge — the classic version of this bug. Python validates structure and geography
only; character validation happens in a Vitest test that loads the generated JSON.

### 2. Sass for logic, CSS custom properties for values

Tailwind v4 `@theme` tokens compile to **runtime** CSS variables. Sass variables resolve at
**build** time and cannot read them. Declaring a colour in both places yields two systems that
drift and break theming.

**There are no `$colour` Sass variables.** Sass is used only for what CSS cannot do: mixins for
repeated texture recipes, `@each` loops for sector-colour variants, compile-time colour maths,
and partials.

### 3. One `requestAnimationFrame` for the entire application

`lib/clock.ts` owns it. The map overlay and the 3D scene *subscribe*; they never start their own
loop. Two loops means two truths about what time it is.

### 4. `src/data/lighthouses.json` is generated, never hand-edited

Corrections go into the scraper, the parser, or `tower-overrides.json`. A hand edit is destroyed
on the next pipeline run.

### 5. The schema has one source

pydantic model → JSON Schema → `schema.gen.ts`. Change a field in one place and the types follow.

### 6. Never present a representation as a likeness

Where the source gives us no usable evidence, the app says so rather than inventing
something plausible. This is a navigational-aid subject; a confident-looking wrong tower is
worse than an honest generic one.

`tower.evidence` carries this per station:

| value | meaning | UI obligation |
|---|---|---|
| `photo` | a usable elevation was visible in the station's own photographs | render normally |
| `generic` | photographs showed only distant aerials or equipment | **must** show the generic-tower note |
| `default` | no override authored; height-derived fallback | **must** show the generic-tower note |

Rules that follow from it:

- Non-`photo` towers render in a **neutral palette** — no invented bands or paint schemes.
- The 3D drawer shows a quiet note: *"No clear photograph of this tower is available, so this
  is a generic lighthouse, not a likeness. Position, character and timing are accurate."*
- That note names what **is** still true. The light data is real for every station; only the
  tower's appearance is a stand-in.
- A `generic` entry is promoted to `photo` only when better imagery actually turns up.

This principle extends beyond towers: the "Not for navigation" footer and the published-phase
caveat are the same idea applied to timing.

### 7. Scrape politely, cache aggressively

One request at a time, ~1 s delay, descriptive User-Agent. HTML is cached to `raw/` on first
fetch so all parser iteration is offline. The site is hit once, not once per debugging run.

---

## Data sources

- **Index** — `https://www.irishlights.ie/tourism/our-lighthouses/lighthouse-list.aspx`
  Plain static HTML, ~65–75 stations, no JS rendering required.
- **Station** — `/tourism/our-lighthouses/<slug>.aspx`, a definition list:
  `Position`, `Sectors`, `Height of Tower`, `Height of Light MHWS`, `Character`, `Range`,
  `Radar Beacon`, `AIS`, plus a photo carousel and history prose.
- `robots.txt` disallows only Umbraco internals; content pages are permitted.

**What the source does *not* give us:** tower shape, paint scheme, or build year as structured
fields. Those feed the 3D generator and so live in hand-authored `src/data/tower-overrides.json`,
defaulting to a height-derived tower when absent. The scraper owns all factual/navigational data;
the override file owns **only** visual styling.

---

## Design direction — "Night Chart"

An Admiralty sea chart read at night. Deliberately not a generic dark dashboard.

- **Palette** — ink-navy ground, aged chart-paper cream text, brass/amber UI chrome. The only
  saturated colour in the entire app is the lights themselves (white / sector red / sector green),
  so the eye is drawn to exactly the thing the app is about.
- **Type** — display **Fraunces**, body **Newsreader**, **Martian Mono** for coordinates, ranges
  and character codes (tabular, reads like chart annotation). No Inter, no Space Grotesk.
- **Texture** — fine paper grain, bathymetric contour lines in panels, graticule ticks on panel
  edges, compass-rose watermark.
- **Motion** — heavy restraint. The lights are the motion; everything else is still so the
  blinking reads.
- **Signature element** — the **character ribbon**: a strip drawing each station's flash pattern
  as bars with a playhead sweeping in real time. You can *read* the rhythm and compare stations.

Tokens live in `src/styles/theme.css` once Phase B starts.

---

## Performance budget

Target 60 fps with all stations blinking on an integrated GPU, verified in the browser
performance panel — not by eye.

- Glow gradients **pre-rendered once per colour** into sprite canvases, blitted with `drawImage`.
  Calling `createRadialGradient` 70× per frame is the obvious approach and the expensive one.
- Cull off-viewport stations; cap DPR at 2; pause on `visibilitychange`.
- Three.js canvas **unmounts** when the drawer closes — no idle WebGL context.
- 3D chunk lazy-loads on first station click.
- No full post-processing stack; the beam is an additive cone plus a cheap sprite.
- While the drawer is open and the map is occluded, the overlay drops to a low redraw rate.

## The 2D → 3D transition

One Motion `MotionValue` `t: 0 → 1`, three consumers — MapLibre camera, Three.js camera
(initialised from the map's final pitch/bearing/zoom so the scene opens where the map left off),
and the DOM drawer. Motion owns `t`; `maath/easing` `damp`/`damp3` handles 3D values inside
`useFrame` (deliberately not a spring library, which would run a scheduler competing with r3f).
`prefers-reduced-motion` collapses the flight to a cross-fade.

---

## TODO

### Phase A — data first (schema is the critical path) · **COMPLETE, SCHEMA FROZEN**

- [x] A1 · Git repo, `CLAUDE.md`, `pyproject.toml` on Python 3.13
- [x] A2 · `scrape_lighthouses.py` — **65 stations cached, 0 failures**
- [x] A3 · `parse_stations.py` — 65/65 parsed clean, 0 issues
- [x] A4 · `build_dataset.py` + `report_coverage.py` — **schema frozen**
- [x] A5 · `gen_types.py` → `schema.gen.ts`, verified against all 65 records

**Outcome — 65 stations, all required fields present on every one.**

| | |
|---|---|
| Position | 65/65, cross-checked against a second source on the page; **max disagreement 19 m** |
| Character | 65/65, 57 distinct strings |
| Ranges | 65/65 parsed into per-colour figures |
| Arcs | 43/43 parsed — 80 sector, 15 visibility, 3 obscured |
| Tower profiles | 65/65 authored — 62 from photographs, 3 generic (see Rule 6) |
| Payload | **115 KiB on load** + 350 KiB histories lazily fetched |

**Decisions taken at the freeze gate:**

1. **History prose is split out** into `histories.json` and fetched when the drawer opens.
   It was 74% of the payload; first load went 471 KiB → 115 KiB.
2. **No `established` field.** The year appears only in prose, and the first year there is
   usually an *earlier* light on a different site (Fastnet's text opens with 1818; the tower
   is 1854). Deriving it would manufacture a fact. History text speaks for itself.
3. **All 65 towers hand-authored** in `tower-overrides.json` from the stations' own
   photographs, with an `evidence` field per entry. The 3 without a usable photograph get a
   neutral generic tower and an explicit note in the UI rather than an invented likeness
   (Rule 6).

**Two things the real markup taught us that an imagined schema would have got wrong:**

- The page carries **two independent positions** — DMS in the spec table and decimal in the
  Google Maps JS. Parsing both and cross-checking turns position from an assumption into a
  verified fact. (The JS also contains a hardcoded `LatLng(57.8, 14.0)` map centre over
  Sweden, which would have quietly poisoned the dataset if matched naively.)
- The `Sectors:` field **conflates three different concepts**: true colour sectors
  (`R262°-281°`), visibility arcs (`W Vis 256°-065°`), and obscured arcs
  (`Obscured by land 277°-302°`). Rendering them identically would tell the viewer that
  Galley Head is a sectored light, which it is not. Each arc now carries a `kind`.

### Phase B — app

- [x] B1 · Scaffold: Vite 6 + React 19 + TS strict, Tailwind v4, Sass, Vitest — builds clean, 0 vulnerabilities
- [x] B2 · Character engine + tests — **48/48 green**, all 65 real characters parse
- [x] B3 · Map + blinking overlay — **60 fps, 0 gradient allocations per frame**
- [x] B3a · Responsive layout + touch input (done before B4 on purpose — see below)
- [x] B4 · Drawer + character ribbon + 3D tower + beam + camera flight (mobile-first)
- [x] B4a · 3D visual quality: environment lighting, tone mapping, reflections, bloom
- [x] B6a · Deep links (`#/fastnet`) — pulled forward from polish; see below
- [x] B5 · Filters, legend, day/night, time scrubber, photos ← *feature complete*
- [x] B6 · Polish: deep links, keyboard nav, reduced-motion, accessibility audit

**B1/B2 outcome.** Builds clean under `tsc --noEmit` with strict mode plus
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; `npm audit` reports 0
vulnerabilities. The character engine is 48 passing tests, the three that matter most being:

- **every one of the 65 published characters parses** — no station falls back to `unparsed`;
- **every timeline's phases sum exactly to its period**, which is what lets the shared clock
  index by `t % periodMs` without drift;
- **no real character needs compressing** — the conventional flash durations fit inside every
  published period. Should that test ever fail, the constants in `timeline.ts` need
  revisiting rather than a silent squeeze.

The parser earns its length on real spellings: `ISO WR 4s`, `Fl(2) WRG 10s.`, `Fl (2)W 15s`,
`Fl R 5 s`, `Fl (4) W 30 secs, Night time only`, `Fl (2) 20s` (no colour — defaults to white
by IALA convention), `Dir Oc WRG 5s (24 hours)`, and Aranmore's `Fl (2) W 20s. Auxiliary Light
Fl R 3s`, which is two lights in one field and parses into a nested `auxiliary` spec.

**Dependency constraints, learned the hard way — do not "upgrade" past these blindly:**

| Package | Pin | Why |
|---|---|---|
| `@react-three/fiber` | `^9` | v8 peers at `react >=18 <19` and cannot take React 19 |
| `@react-three/drei` | `^10` | pairs with fiber v9 |
| `react` / `react-dom` | `~19.2.0` | r3f 9.7 peers at `react >=19 <19.3`; npm resolves 19.3 otherwise |
| `maplibre-gl` | `^6.10` | everything `<=6.4.0` carries a **critical** advisory |

**Note on `vite.config.ts` chunking:** `maplibre-gl` *is* a manual chunk (it is needed for
first paint and changes rarely, so it caches well). `three` deliberately is **not** — naming a
module in `manualChunks` makes Rollup treat it as an *eager* entry, which would ship ~194 KiB
of Three.js on first load even though nothing imports it until a station is clicked. The 3D
scene will be split by `import()` instead.

---

## B3 — map and blinking overlay

Working and measured. Three hiccups, all worth remembering:

**1. MapLibre hung silently — no map, no error.** Vite's dependency pre-bundler rewrites
MapLibre's `new Worker(new URL(...))` to a path inside `.vite/deps` that is never emitted, so
the worker 404s. MapLibre then waits forever for a worker that will never answer: no style
loads, no `load` event fires, and **no error is raised**, which is what made it slow to find.
Fixed with `optimizeDeps: { exclude: ['maplibre-gl'] }` plus `worker: { format: 'es' }`.
**If the map is ever blank again, check for a 404 on `maplibre-gl-worker.mjs` first.**

**2. The map container collapsed to zero height.** `maplibre-gl.css` sets
`position: relative` on `.maplibregl-map` once the map mounts, overriding an `absolute
inset-0` container so `top`/`bottom` stop constraining it. The container must size itself
(`h-full w-full`), not rely on absolute insets.

**3. Overlapping stations made hover flicker.** Aranmore and Ballagh Rocks are 5.4 km apart —
**2.9 pixels at zoom 5.6** — so both sit inside the 14 px hit radius and the winner flipped on
sub-pixel movement. Real geography, not a projection bug; Cork Harbour and Dublin Bay are the
same. Solved with hysteresis (`STICKY_FACTOR`): the pointer keeps the station it is on unless
a rival is >35% closer.

### The basemap is restyled, not used as shipped

`lib/nightChart.ts` recolours CARTO's dark-matter after load. Stock dark-matter is built for
cities: land is the dark field, **water is lighter than land**, and the full road network is
drawn. For a chart of navigational aids that is backwards on both counts. We invert it — sea
is the darkest thing on screen, land is lifted — and hide road, rail, landuse and building
layers so nothing competes with the lights.

### Verified performance

Measured in the browser, not estimated:

| Metric | Result |
|---|---|
| `createRadialGradient` calls per 3 s | **0** — the sprite cache holds |
| Frame rate | 60 fps (median interval 16.7 ms) |
| p95 / max frame interval | 17.8 ms / 18.4 ms — no dropped frames |
| Initial payload | 78 kB gzip app + 278 kB gzip MapLibre + 15 kB CSS |

MapLibre's 278 kB gzip is irreducible without replacing the renderer; `chunkSizeWarningLimit`
is raised to 1100 kB because the default advisory fires every build with no action available.

---

## B3a — responsive and touch

Done before B4 rather than after, deliberately. The drawer is the most layout-sensitive
component in the app and on a phone it has to be a bottom sheet rather than a side panel, so
building it desktop-only would have meant building it twice.

**The important part was not cosmetic.** Every interaction hung off `mousemove` and `click`,
and `mousemove` never fires on a touch screen — the read-out was simply dead on a phone. The
overlay now uses Pointer Events:

- Hover stays mouse-only; on touch the equivalent is a tap.
- **Tap detection distinguishes a tap from a pan** — a pointerdown/up pair that moves more
  than 10 px or takes longer than 600 ms is a map drag and must not select anything.
- The hit radius is **14 px for a mouse, 30 px for a finger**. A fingertip is nothing like a
  cursor and 14 px is unusable.
- Tapping empty sea dismisses the read-out; panning does not.

**Layout:** the chrome is one flex column over the map rather than absolutely positioned
corners, so the masthead and controls cannot overlap at any width (at 375 px they did, badly).
Control chips get `min-h-8` to be thumb-reachable, and copy switches between "Tap" and "Hover"
from `(pointer: coarse)`.

**Camera framing accounts for the chrome.** `framePadding()` pads the fitted bounds by the
space the masthead and read-out occupy (150/90 px on a phone), so the north coast is not
hidden under the title. It re-frames on crossing the 640 px breakpoint — but only if the user
has not moved the map themselves, since yanking someone's view back would be obnoxious.

Verified at 375×812, 768×1024 and 1471×909: no overlap, and mouse hover still resolves
correctly on desktop.

---

## Rotating sweeps on the map

The map no longer blinks dots — lights with a rotating optic throw **real sweeping beams**,
turning once per period with one beam per panel. This is more correct than blinking, not just
prettier: a flashing character *is* an optic turning, and the flash is the beam passing you.
`Fl (3) W 15s` shows three beams because the lens has three panels, which is why it flashes
three times in fifteen seconds.

**One definition of "rotating", shared by both renderers.** `lib/character/optic.ts` owns
`isRotating()` and `panelCount()`; `Beam.tsx` previously had its own private copy of that set.
The map sweep and the 3D beam now read the same answer from `Station`, so the tower and the
dot representing it cannot disagree about what kind of light it is. Same reasoning as Rule 1.

**Isophase, occulting and fixed lights do not sweep.** They pulse. Occulting is a fixed lamp
briefly screened, not a turning one, and drawing it as a sweep would misrepresent it.

**Beam length is the published range**, converted through real metres-per-pixel at the current
zoom, so a 27 nm light genuinely reaches further than a 5 nm one.

- True to scale, that is 27 px against 5 px with the whole island in view — invisible, and the
  sweeps read as asterisks. `rangeExaggeration()` stretches every beam by the *same* factor, so
  relative lengths stay exactly true, decaying to 1 as you zoom in where real scale is
  meaningful. **The legend says so** rather than letting the viewer assume the beams are to
  scale at every zoom.

### The bug that froze every beam: `ctx.rotate()` and float32

The first version of the sweeps did not rotate at all, and the reason is worth knowing.

The obvious way to get a rotation angle is:

```ts
const spin = ((tMs + offset) / periodMs) * Math.PI * 2;   // WRONG
```

`tMs` is wall-clock milliseconds (~1.79e12), so that produces about **3.7 billion radians**.
Canvas 2D takes the angle as **float32**, where the ULP at 3.7e9 is roughly **256 radians** —
so a frame's worth of rotation (0.035 rad) is rounded clean away. Measured directly in the
browser: `rotate(3.75e9)` and `rotate(3.75e9 + 0.035)` render **pixel-identical** output,
while the same delta on a wrapped angle moves 93 pixels.

Fix: wrap into one revolution first. `progressAt()` already does this correctly, so both
renderers now use it:

```ts
const spin = progressAt(timeline, tMs, offsetMs) * Math.PI * 2;
```

**The 3D beam had the identical expression and worked**, because Three.js keeps the angle in
float64 — so the two renderers silently disagreed, which is exactly what the shared clock is
supposed to make impossible. Both are wrapped now, and `character.test.ts` carries a
regression test at realistic wall-clock timestamps.

Worth remembering generally: **anything derived from `Date.now()` and handed to a graphics
API should be reduced to its useful range first.** The failure is silent — no error, no
warning, just a picture that never moves.

**Performance.** Each sweep is a wedge sprite built once per colour from raw `ImageData` —
a wedge needs radial *and* angular falloff multiplied, which no single canvas gradient gives.
Rotation is then a transform on `drawImage`. Up to ~5 beams × 65 stations per frame and it
still measures **60 fps, zero gradient allocations, one dropped frame in five seconds**.
Beam alpha is deliberately low (0.32): at full brightness 65 stations bury the coastline.

---

## B4 — drawer, ribbon, 3D tower

### The 3D towers are generated, not modelled

`three/buildProfile.ts` revolves a silhouette sized from the published tower height and paints
it with a canvas stripe texture built from `tower-overrides.json`. No per-station assets. The
result is verifiably distinct where it should be: Hook Head shows its broad black bands, St
John's Point (Down) its black-and-yellow, Fastnet its bare grey granite, Kish Bank its caisson.

Two things learned tuning it:

- **Scale the camera to the tower, never with an absolute floor.** `Math.max(4.5, height*2.8)`
  parked the camera 4.5 units from Dunree's 0.6-unit tower and rendered it as a speck. The
  range is 6 m to 54 m — a factor of nine — so the offset must be *additive*
  (`height * 2.8 + 0.5`), not a floor. Same applies to `OrbitControls` min/max distance.
- **The beam must be shorter than the framed view.** Deriving its length from the lantern
  radius gave Maidens a 64-unit beam on a 2.3-unit tower; the frame filled with grey haze and
  the lighthouse vanished. It is now `focalHeight * 2.2` at 0.1 opacity — the tower is the
  subject, the beam only shows its rhythm.

**Rotating lights are modelled as rotating.** A flashing character comes from an optic with N
panels turning once per period, so `Beam` draws `group` cones spaced evenly and rotates the
assembly once per period. `Fl (3) W 15s` flashes three times in fifteen seconds because the
geometry says so. Isophase, occulting and fixed lights do not sweep, so they get an
omnidirectional halo that modulates instead.

### Rule 3 held, despite r3f

React Three Fiber runs its own `requestAnimationFrame`, which would have given the app a
second clock. The canvas instead runs `frameloop="demand"` with a `Ticker` that invalidates it
from the shared clock, and the beam reads `clock.now()` rather than r3f's elapsed time. One
driver — and when the clock stops (tab hidden), the 3D stops with it.

### Where Tailwind lost and Sass won

The drawer sets the *same* properties to conflicting values across breakpoints
(`left: 0` for the bottom sheet, `left: auto` for the side panel). Tailwind resolves that by
source order within its utilities layer, and `left-0` lands after `sm:left-auto`, so the
responsive override silently loses — the panel docked to the *left* on desktop. `_drawer.scss`
does it with a media query instead. This is the boundary in Rule 2 working as intended: Sass
for what utilities cannot express cleanly, no duplicated token values.

### Deep links, pulled forward

`#/fastnet` opens Fastnet. Moved up from the polish milestone because without it there is no
way to address a lighthouse — to share one, reload onto one, or drive one directly when
testing. One trap worth remembering: the URL-mirroring effect runs on mount while `selectedId`
is still null, so without a first-run guard it **wipes the very hash it was asked to open**.

### Verified

| Check | Result |
|---|---|
| Deep link `#/hook-head` | opens the drawer, bands render |
| Ribbon playhead | sweeps 5.3% per 260 ms on a 5 s period — correct |
| Generic-tower note | shows on `ballycotton`, absent on `fastnet` |
| WebGL released on close | canvases 3 → 2, via button and via Escape |
| Three.js lazy | own 248 kB gzip chunk, not on first paint |
| Histories lazy | own 119 kB gzip chunk |

**Bundle:** 145 kB gzip on first paint plus 278 kB MapLibre; **deferred** until a station is
opened: the Scene chunk and the histories chunk.

---

## B4a — making the towers look like lighthouses

The first pass rendered as flat grey primitives. Four changes fixed that, and they matter far
more than additional geometry:

1. **An environment map.** `MeshStandardMaterial` is physically based — with nothing to
   reflect it can only look like plastic. Built from drei `Lightformer` panels rather than a
   downloaded HDRI, so there is no network request and the light can be tinted to the
   Night Chart palette.
2. **ACES tone mapping** at 1.35 exposure. Raw linear output crushed the darks together,
   which is why every tower read as the same black shape regardless of its paint.
3. **Reflections in the water**, with a procedurally generated swell normal map. A lighthouse
   stands in the sea; a flat matte disc reads as grey card.
4. **Bloom on the lamp**, with the lamp core driven above 1.0 and `toneMapped: false` so it
   actually crosses the bloom threshold. A light source that does not bleed does not look
   like one.

Geometry that earns its place: astragals as real bars (not a `wireframe` material), a railed
gallery with posts and corbels, plinth, rock base, domed roof with vent and finial, door and
window openings for scale, and a sea wall around the keeper's dwelling. Textures — swell
normals and paint weathering — are generated at runtime in `three/textures.ts` rather than
shipped as files.

**This deliberately revisits the earlier "no post-processing" rule.** That rule was written
for a full-screen canvas. This one is ~384×320 inside a drawer and only exists while a station
is open, so bloom is affordable. Re-measure after any change here: **60 fps, median 18.2 ms,
max 22.8 ms, zero dropped frames** with the drawer open and two WebGL contexts live.

Cost: the Scene chunk grew 248 → 297 kB gzip. It is lazy, so first paint is unchanged.

### Two traps worth remembering

- **Per-vertex alpha on an additively blended material blew the canvas to solid white.** The
  beam falloff is an `alphaMap` down the cone's V axis instead, which is the well-trodden
  route. Symptom to recognise: the whole 3D panel goes white with no console error.
- **`toneMapped: false` belongs on the lamp core only.** On the beam cones — which are
  additive and overlap each other — unmapped values accumulate without clamping and bloom
  turns the frame white.

### The supplied generic GLTF model — done

`public/models/generic-lighthouse.glb` (2 MB) is wired up in `three/GenericTower.tsx`.

**Used for exactly three stations** — `ballagh-rocks`, `ballycotton`, `st-johns-donegal`, the
ones with `evidence !== 'photo'`. The other 62 keep their generated towers: a single shared
model would discard Hook Head's bands, Fastnet's granite and St John's Point's black-and-yellow,
which are real and come from data. This is precisely the case Rule 6 was written for, and the
drawer still shows the caveat.

**Three things the file needed before it could be used:**

1. **The texture was bound as `emissiveTexture`**, with `baseColorFactor` black and
   `emissiveFactor` white — a photogrammetry export convention that renders the model fully
   unlit. Dropped in as-is it was a flat cut-out beside towers that respond to moonlight.
   Rebound as the base-colour map, with a trace of emissive so the dark side does not go to
   pure black on a night scene.
2. **Orientation had to be verified, not assumed.** The bounding box is *wider than tall*
   (1.62 × 1.16 × 1.90), which looks like a model lying on its side. Checking the
   cross-sectional radius along each axis settled it: Y falls monotonically and steps from
   0.86 to 0.30 at 60% height — a broad base with a slender tower above — while X and Z are
   symmetric bulges. **Y is already up; no rotation needed.** The scan simply includes the
   rock and outbuildings, not just the tower.
3. **Scale, and then the camera.** Scaling the tower portion to the published height is right,
   but because the scan's footprint is ~4× the tower height, the camera ended up *inside the
   rock*. `genericFootprintRadius()` exports the measured geometry so `Scene` can pull the
   camera back to clear it.
4. **The tower is not on the model's origin.** Slicing the vertices by height gives a
   consistent tower axis at x ≈ 0.000 but **z ≈ +0.186** — the lighthouse stands off-centre
   on its pier, while the bounding-box centre is z ≈ +0.003. Placing the light at the local
   origin left it hanging in mid-air *beside* the tower. `GENERIC_LANTERN` records the
   measured axis; the beam is offset onto it and the camera orbits it, so the lighthouse
   stays put in frame instead of swinging around the pier.

   The lantern height is 0.90 of the model, not 1.0: the topmost 3% is the finial spike
   (radius 0.015), while the lantern room proper sits around 0.85–0.95 at radius ~0.09.

**A lesson for any future model:** none of these four could be taken on trust. Bounding box,
up-axis, tower axis and lantern height were all *measured from the mesh* — and three of the
four contradicted the obvious assumption.

The model is in `public/`, never imported, so its 2 MB is fetched only when one of those three
stations is opened. 60 fps holds with it loaded.

### Swapping in another GLTF later

`Tower` is the seam. `Scene.tsx` renders `<Tower station={…} />` and nothing else knows how
the tower is made, so dropping in a `.glb` means loading it there and choosing between the
model and the procedural build. Worth keeping in mind when that happens:

- The generated tower is **scaled from real published height** (`METRES = 0.1` world units per
  metre). A single generic model must be scaled per station the same way, or a 6 m harbour
  light and 54 m Fastnet will look identical.
- The **paint scheme is a generated texture** mapped to the lathe's V axis. A GLTF brings its
  own UVs, so `tower-overrides.json` bands will need re-mapping or the model needs a material
  slot we can tint.
- `Beam` is positioned from `focalHeight`, which `buildProfile` computes. A model needs an
  equivalent — either a named empty/node at the lantern, or a measured constant.
- Rule 6 still applies: a generic model used for a station we have no photograph of is still
  a representation, and must keep its caveat.

---

## B5 — filters, legend, day/night, scrubber, photos

### Removed: day/night and the time scrubber

Both were built, both worked, and both were cut. They added three controls
(Live · All lit · a 24-hour slider) to an app whose purpose is to show where the lights are
and how they blink. Someone opening it at midday saw a dark coast, which is truthful but
useless. **Every light now always burns.**

`lib/sun.ts` is kept on disk though nothing imports it: the solar maths is correct and cheap
to keep, so a "what does the coast look like at 3am" view could return without rewriting it.
`clock.setTime` / `resetToNow` are likewise retained as a complete clock API.

*If controls start multiplying again, this is the precedent: the map is the product, and a
control that does not help you read a rhythm is a control to cut.*

**The legend doubles as the colour filter** — reading what a colour means and isolating it are
the same gesture. Building it surfaced a real inconsistency: counting only each station's
*primary* colour reported **"green 0"** while several stations have green sectors. Both the
count and the filter now match on every colour a light shows (`allColours`), giving
white 63 · red 29 · green 5. A `Fl (2) WRG 10s` light really is a green light from the
right bearing, and saying otherwise was worse than showing no count.

**Photos** are the images the tower profiles were authored from, so showing them next to the
3D model lets a reader check our work — which matters given Rule 6. Lazily loaded, and each
one removes itself on error rather than leaving a broken frame.

---

## B6 — accessibility

Audited against WCAG 2.1 AA. Contrast measured in the browser, not estimated.

### The critical one: the map is a canvas

Without intervention, all 65 lighthouses — the entire content of the app — were unreachable
by keyboard or screen reader (**2.1.1**, **1.1.1**, **4.1.2**). No amount of ARIA on a
`<canvas>` fixes that.

`StationList` is the fix: a real `<nav>` of 65 focusable buttons, `sr-only` until focus
enters, then revealed as a visible panel so a sighted keyboard user can see where they are
rather than chasing an invisible focus ring. Focusing an entry highlights that light on the
map exactly as hovering does; Enter opens the drawer; Escape closes it. Each entry carries a
spoken-only description, because `Fl (2) WRG 10s` read aloud is meaningless.

### Contrast failures found and fixed

| Token | Was | Ratio | Now | Ratio |
|---|---|---|---|---|
| `--color-paper-faint` | `#7d7566` | **4.27** ✗ | `#837b6b` | 4.64 ✓ |
| `--color-brass-dim` | `#8f7139` | **4.38** ✗ | `#94753b` | 4.65 ✓ |

Also added `--color-edge` (3.01:1) for **control** borders, keeping `--color-graticule`
(1.33:1) for decorative hairlines. That split is deliberate: 1.4.11 applies to borders that
identify a UI component, not to chart linework that carries no information.

### Touch targets

Control chips were 32 px against the 44 px in **2.5.5**. Now `min-h-11` on coarse pointers
and `sm:min-h-8` on desktop, where a mouse does not need it and the chart should not be
swamped by chrome.

### Reduced motion, without gutting the app

Blinking is the *content* here, so `prefers-reduced-motion` does not simply switch it off —
that would remove the reason the map exists. Lights are held at a steady glow, every station
still visible at its own colour and position, and a **Blinking on/off** chip appears *only*
for viewers with that preference, offering the rhythms back rather than deciding for them.
The character ribbon still shows each rhythm as static bars regardless.

### Testing note

Synthetic `KeyboardEvent` and programmatic `.focus()` do **not** exercise these paths — both
appeared broken until driven with real key presses. If keyboard behaviour ever looks broken,
check with a genuine `Tab`/`Escape` before believing it.

### Not covered

Real screen-reader testing (VoiceOver/NVDA) and real-device touch remain unverified
(TD-11, TD-12) — automated checks catch roughly a third of issues.

---

## Two production bugs found while testing B6

Both were found only because the tile CDN went quiet mid-session. Both would have shipped.

### 1. A dead basemap took out every light

`LightOverlay` was mounted on MapLibre's `'load'` event — which waits for the first tiles and
**never fires at all** if they cannot be fetched. So a CDN failure produced not "lights over a
blank map" but an empty black screen.

The overlay needs only `map.project()`, which works off the camera transform set from `bounds`
at construction. `MapView` now publishes the map instance immediately and applies the night
chart on `'style.load'`. Verified in the degraded state: all 65 lights render and blink with
no basemap at all, Ireland's outline traced by the lighthouses themselves.

**The lights are the product; they must outlive the basemap.**

### 2. MapLibre's worker was never emitted into `dist/`

MapLibre v6 computes its worker URL at *runtime*:

```js
let e = import.meta.url;
if (!/^https?:/.test(e)) return '';
return new URL('./maplibre-gl-worker.mjs', e).href;
```

Because that is built at runtime rather than written as a literal
`new URL(..., import.meta.url)`, Rollup cannot see it and emits no worker file. In a
production build `import.meta.url` becomes the bundle's own URL, so MapLibre requested
`/assets/maplibre-gl-worker.mjs`, fell through to the SPA's `index.html`, and the browser
rejected it for a `text/html` MIME type. **The basemap silently never rendered — in
production only.** Dev was fine throughout, which is what made it dangerous.

Fixed with the supported API plus a Vite-**bundled** worker:

```ts
// ?worker&url — NOT ?url
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
setWorkerUrl(maplibreWorkerUrl);
```

**The `?url` / `?worker&url` distinction is the whole bug, and the first attempt got it
wrong.** `?url` copies the file byte-for-byte and does not follow its imports — the emitted
asset was 19,007 bytes, identical to source, still opening with
`import {...} from './maplibre-gl-shared.mjs'`. That 514 KB chunk was never emitted, so the
worker 404'd on its own import and died. `?worker&url` bundles it: the emitted worker is now
509 KB with **zero unresolved imports**.

**The symptom is worth recognising.** The style loads on the main thread, so the background
layer paints and `applyNightChart` runs — but vector tiles are parsed *in the worker*, so no
coastline ever appears. **A uniform land-coloured background with no geography means the
worker is dead, not that the tiles are missing.**

Also: MapLibre fetches tiles from inside the worker, so `.mvt` requests do **not** appear in
the main thread's Resource Timing API. Counting them to check whether tiles are loading is
meaningless — a working map shows zero. Look at the pixels.

Verified in a real production build (`npm run build && npm run preview`): Ireland renders,
repeatably, across reloads.

### And the `manualChunks` rule, restated

Checking whether chunking caused the worker problem confirmed the standing rule: **do not add
`manualChunks`.** It has now caused two separate silent failures on this project. `vite.config.ts`
carries the full explanation.

---

### Verified per tower

Hook Head's broad black bands, Inisheer's twin black bands, St John's Point (Co Down) in
black and yellow, Fastnet's bare grey granite with the concave wave-swept flare — all from
`tower-overrides.json` through one generator, no per-station assets.

---

## Tech debt register

| # | Item | Severity | Notes |
|---|------|----------|-------|
| TD-1 | 3 towers are `evidence: "generic"` | low | `ballagh-rocks`, `ballycotton`, `st-johns-donegal` — photographs showed only distant aerials. They now render the supplied generic GLTF model with a note (Rule 6). Promote to `photo` if better imagery appears. |
| TD-15 | Generic model is one harbour lighthouse | low | The scan is a specific harbour light on a round pier, shown for three stations that are a rock beacon, a headland light and a coastal tower. It is honest (labelled a stand-in) but visually says "harbour". A plainer, less site-specific model would generalise better. |
| TD-2 | `radar_beacon` 12/65, `ais` 36/65 | none | Genuinely sparse at source, not a parse failure. Render conditionally; do not chase. |
| TD-3 | 3 stations have no published tower height | low | `copper-point`, `mizen-head`, `valentia-directional-light`. All three are box structures, so the 3D generator does not need it. `light_height_m` is present for all 65. |
| TD-4 | Arc `kind` is a bare `string` | low | Should be a union (`"sector" \| "visibility" \| "obscured"`) in `schema.gen.ts`. Needs `Literal` types in the pydantic model so the generator emits it. Same for `Tower.shape` and `coast`. |
| TD-5 | `gen_types.py` hand-rolls JSON-Schema→TS | low | Fine for 7 fixed models; revisit only if the model set grows or nested generics appear. |
| TD-9 | Camera flight is linear in lng/lat/zoom | low | `flight.ts` lerps each component. Fine for short hops; a long descent would benefit from MapLibre's parabolic `flyTo` curve. Kept explicit because we need the progress value, not MapLibre's queue. |
| TD-10 | Bottom read-out duplicates the open drawer | low | On desktop the hover read-out sits bottom-left while the drawer shows the same station. Harmless but redundant — hide it while a drawer is open. |
| TD-12 | No real screen-reader testing | medium | `StationList` is built correctly and verified with real key presses, but VoiceOver/NVDA announcement order and the drawer's focus behaviour are unverified. Automated checks catch ~30% of issues. |
| TD-13 | Drawer does not trap or restore focus | low | Opening the drawer from the station list leaves focus in the list. It should move into the drawer and return on close. Not a blocker — Escape works and the drawer is not modal — but it is the next keyboard improvement. |
| TD-11 | Touch verified only under emulation | medium | All touch testing used synthetic `pointerType: 'touch'` events. Real-device quirks (Safari gesture handling, momentum scroll vs MapLibre pan) are unverified. |
| TD-7 | No coastline without network | low | *Downgraded:* the lights now render and blink correctly with no basemap at all, and a note explains the missing coastline. A bundled Ireland outline would still be better than nothing. |
| ~~TD-14~~ | ~~Production basemap unconfirmed~~ | **closed** | Root cause was `?url` not bundling the worker's imports. Fixed with `?worker&url`; verified rendering in a real production build across reloads. |
| TD-8 | Station labels only appear at zoom ≥ 7.4 | low | Below that they collide badly in clusters. Proper label collision (or MapLibre symbol layers with `text-allow-overlap: false`) would let us show more, sooner. |
| TD-6 | Photo URLs point at irishlights.ie | medium | `fetch_photos.py` can produce local WebP, but the dataset still carries remote URLs. Decide at B5 whether to self-host (faster, avoids hotlinking) or keep remote (no asset weight in the repo). |

### Known risks, accepted knowingly

| Risk | Mitigation |
|------|------------|
| Umbraco markup changes break the scraper | `raw/` cache; parser fails loudly per-field rather than emitting silent nulls; `report_coverage.py` |
| Sectored lights are bearing-dependent | Map shows dominant sector colour; drawer draws the full sector diagram |
| `tower-overrides.json` lags the dataset | Height-derived default keeps it non-blocking; coverage report lists stations still on the default |
| CARTO basemap terms may not suit | One-line style-URL swap to Protomaps |

---

## Commands

The pipeline runs in order; each stage reads only the previous stage's output.

```bash
uv run src/scripts/scrape_lighthouses.py               # -> raw/ HTML cache (--refresh to re-fetch)
uv run src/scripts/parse_stations.py                   # raw/ -> raw/parsed.json
uv run src/scripts/build_dataset.py                    # -> lighthouses.json + histories.json
uv run src/scripts/gen_types.py                        # -> schema.gen.ts
uv run src/scripts/report_coverage.py                  # coverage table; non-zero exit on regression
```

Photos, and the reference sheets used to author tower profiles:

```bash
uv run src/scripts/fetch_photos.py --contact-sheet --per-station 4   # small reference JPEGs
uv run src/scripts/fetch_photos.py --montage                         # labelled grids, one row per station
uv run src/scripts/fetch_photos.py                                   # web-sized WebP -> public/photos
```

Debug a single station without touching the network:

```bash
uv run src/scripts/parse_stations.py --station fastnet
```

## Conventions

- Anything mechanisable gets a script in `src/scripts/` rather than being done by hand.
- Python runs through `uv` on a pinned 3.13 (system Python is 3.9 — do not use it).
- Every milestone ends by updating the TODO and tech-debt sections of this file.
