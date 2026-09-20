/**
 * The blinking lights.
 *
 * A single canvas over the map, redrawn from the shared clock. Every station's
 * brightness comes from `sampleAt` — the same call the 3D beam will use — so the
 * dot and the tower can never disagree about whether a light is on.
 *
 * PERFORMANCE — the decisions here are the ones that keep this at 60fps:
 *
 *  1. Glows are pre-rendered ONCE per colour into offscreen sprite canvases and
 *     blitted with `drawImage`. The obvious implementation calls
 *     `createRadialGradient` per light per frame — 65 gradient objects allocated
 *     and rasterised 60 times a second — and it is by far the biggest cost in a
 *     naive version of this component.
 *  2. Stations outside the viewport are skipped before any drawing happens.
 *  3. Device pixel ratio is capped at 2. A 3x phone gains nothing visible from a
 *     soft glow and pays 2.25x the fill cost.
 *  4. No React state is touched per frame. React renders this component once;
 *     the canvas is then driven imperatively. Pushing 60 setStates a second
 *     through the tree would dwarf every saving above.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { progressAt, sampleAt } from '../lib/character/sample';
import type { LightColour } from '../lib/character/types';
import { subscribe } from '../lib/clock';
import { LIGHT_COLOURS, type Station, stations } from '../lib/stations';
import { type Coast, useApp } from '../state/store';

const MAX_DPR = 2;

/** Sprite size in CSS pixels; the glow is drawn scaled down from this. */
const SPRITE_SIZE = 128;
const SPRITE_RADIUS = SPRITE_SIZE / 2;

/** Radius of the visible halo, and of the solid core, in CSS pixels. */
const GLOW_RADIUS = 26;
const CORE_RADIUS = 2.6;

/**
 * Hit radius in CSS pixels. A fingertip is nothing like a cursor, so touch gets
 * a much larger target — 14 px is unusable on a phone.
 */
const HIT_RADIUS_FINE = 14;
const HIT_RADIUS_COARSE = 30;

/** A pointer that moves further than this between down and up was a pan, not a tap. */
const TAP_SLOP_PX = 10;
const TAP_TIMEOUT_MS = 600;

/**
 * How much closer a rival station must be before the pointer lets go of the one
 * it is already on.
 *
 * Stations genuinely overlap at low zoom: Aranmore and Ballagh Rocks are 5.4 km
 * apart, which at zoom 5.6 is **2.9 pixels** — both sit comfortably inside the
 * hit radius. Without hysteresis the label flickers between them on sub-pixel
 * pointer movement. The same is true around Cork Harbour and Dublin Bay.
 */
const STICKY_FACTOR = 1.35;

/** Sweep sprite resolution. Drawn once per colour, then blitted with rotation. */
const SWEEP_SIZE = 256;
/** Half-width of the beam wedge, in radians (~15°). */
const SWEEP_HALF_ANGLE = 0.26;

/** A nautical mile, for turning published ranges into real map distances. */
const METRES_PER_NM = 1852;
/** Web Mercator metres per pixel at zoom 0 on the equator. */
const EQUATOR_METRES_PER_PIXEL = 156543.03392;

/**
 * Shortest a beam may be drawn, in CSS pixels.
 *
 * At country zoom a 5 nm light is about 5 px, which is invisible. The floor
 * keeps small lights findable; above it, length is true to the published range,
 * so Fastnet's 18 nm really does reach further than Ballagh Rocks' 5 nm.
 */
const MIN_SWEEP_PX = 16;
const MAX_SWEEP_PX = 420;

/**
 * How much the beams are lengthened so range is legible at low zoom.
 *
 * True to scale, a 27 nm light is 27 px with the whole island in view, and a
 * 5 nm one is 5 px — the difference that matters is invisible, and the sweeps
 * read as asterisks. This stretches every beam by the *same* factor, so their
 * relative lengths stay exactly true to the published ranges; it decays to 1 as
 * you zoom in, where real scale is meaningful and a 27 nm beam would otherwise
 * cross the screen.
 *
 * The exaggeration is stated in the legend rather than left for the viewer to
 * assume the beams are to scale at every zoom.
 */
function rangeExaggeration(zoom: number): number {
  return Math.max(1, 3.4 - Math.max(0, zoom - 5) * 0.4);
}

type SpriteCache = Record<LightColour, HTMLCanvasElement>;

/**
 * Build one radial-gradient sprite per light colour. Called once.
 * The stops are tuned to read as a lamp seen across water: a tight bright core
 * falling away fast, then a long faint halo.
 */
function buildSprites(): SpriteCache {
  const cache = {} as SpriteCache;

  for (const [name, css] of Object.entries(LIGHT_COLOURS) as [LightColour, string][]) {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_SIZE;
    canvas.height = SPRITE_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    const gradient = ctx.createRadialGradient(
      SPRITE_RADIUS,
      SPRITE_RADIUS,
      0,
      SPRITE_RADIUS,
      SPRITE_RADIUS,
      SPRITE_RADIUS,
    );
    gradient.addColorStop(0, `${css}ff`);
    gradient.addColorStop(0.08, `${css}dd`);
    gradient.addColorStop(0.22, `${css}66`);
    gradient.addColorStop(0.5, `${css}1f`);
    gradient.addColorStop(1, `${css}00`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    cache[name] = canvas;
  }

  return cache;
}

/**
 * One beam wedge per colour, pointing along +X, built once.
 *
 * Generated as raw pixels rather than canvas gradients because a wedge needs
 * *two* falloffs multiplied together — radial along its length and angular
 * across its width — which no single gradient gives. Doing it once at start-up
 * keeps the frame loop free of allocations, exactly as the glow sprites do:
 * the rotation is then just a transform on `drawImage`.
 */
function buildSweepSprites(): SpriteCache {
  const cache = {} as SpriteCache;
  const half = SWEEP_SIZE / 2;

  for (const [name, css] of Object.entries(LIGHT_COLOURS) as [LightColour, string][]) {
    const canvas = document.createElement('canvas');
    canvas.width = SWEEP_SIZE;
    canvas.height = SWEEP_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    const r = parseInt(css.slice(1, 3), 16);
    const g = parseInt(css.slice(3, 5), 16);
    const b = parseInt(css.slice(5, 7), 16);

    const image = ctx.createImageData(SWEEP_SIZE, SWEEP_SIZE);
    const data = image.data;

    for (let y = 0; y < SWEEP_SIZE; y += 1) {
      for (let x = 0; x < SWEEP_SIZE; x += 1) {
        const dx = x - half;
        const dy = y - half;
        const dist = Math.hypot(dx, dy) / half;
        const i = (y * SWEEP_SIZE + x) * 4;

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;

        if (dist > 1) continue;

        // Across the beam: bright on the axis, gone at the edges.
        const angle = Math.abs(Math.atan2(dy, dx));
        if (angle > SWEEP_HALF_ANGLE) continue;
        const across = Math.cos((angle / SWEEP_HALF_ANGLE) * (Math.PI / 2)) ** 1.5;

        // Along the beam: brightest at the lantern, fading with distance, as
        // light actually does. A beam that stops at a hard edge looks painted.
        const along = (1 - dist) ** 1.5;

        data[i + 3] = Math.round(255 * across * along * 0.85);
      }
    }

    ctx.putImageData(image, 0, 0);
    cache[name] = canvas;
  }

  return cache;
}

/** Published range of a light in nautical miles — the longest colour it shows. */
function rangeNm(station: Station): number {
  const ranges = station.ranges ?? [];
  if (ranges.length === 0) return 10;
  return Math.max(...ranges.map((r) => r.nautical_miles));
}

interface Props {
  map: MapLibreMap;
}

export function LightOverlay({ map }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spritesRef = useRef<SpriteCache | null>(null);
  const sweepsRef = useRef<SpriteCache | null>(null);

  // Read through refs inside the frame loop: the loop is created once and must
  // see current values without being torn down and rebuilt on every state change.
  const stateRef = useRef(useApp.getState());
  useEffect(() => useApp.subscribe((s) => (stateRef.current = s)), []);

  /** Screen positions from the last frame, reused for hit-testing. */
  const projectedRef = useRef<{ station: Station; x: number; y: number }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return undefined;

    spritesRef.current ??= buildSprites();
    sweepsRef.current ??= buildSweepSprites();

    let dpr = 1;
    const resize = () => {
      const { clientWidth, clientHeight } = map.getContainer();
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(clientWidth * dpr);
      canvas.height = Math.round(clientHeight * dpr);
      canvas.style.width = `${clientWidth}px`;
      canvas.style.height = `${clientHeight}px`;
    };
    resize();
    map.on('resize', resize);

    const draw = (tMs: number) => {
      const sprites = spritesRef.current;
      const sweeps = sweepsRef.current;
      if (!sprites || !sweeps) return;

      // Real distance per pixel at this zoom and latitude, so a beam's length
      // on screen is its published range — and grows correctly as you zoom in.
      const zoom = map.getZoom();
      const centreLat = (map.getCenter().lat * Math.PI) / 180;
      const metresPerPixel =
        (EQUATOR_METRES_PER_PIXEL * Math.cos(centreLat)) / Math.pow(2, zoom);

      const { width, height } = canvas;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width / dpr, height / dpr);

      const { coasts, colours, selectedId, hoveredId, reduceMotion, motionOverride } =
        stateRef.current;
      const animate = !reduceMotion || motionOverride;
      const cssWidth = width / dpr;
      const cssHeight = height / dpr;
      const margin = GLOW_RADIUS * 2;

      const projected = projectedRef.current;
      projected.length = 0;

      ctx.globalCompositeOperation = 'lighter';

      for (const station of stations) {
        // `coast` is a plain string in the generated schema (see TD-4); the
        // pipeline only ever emits the four compass values.
        if (!coasts.has(station.coast as Coast)) continue;
        // Match any colour the light shows, not just the one drawn on the map:
        // a WRG sector light really is a green light from the right bearing.
        if (!station.allColours.some((c) => colours.has(c))) continue;

        const point = map.project([station.position.lon, station.position.lat]);

        // Cull before doing any work per light.
        if (
          point.x < -margin ||
          point.y < -margin ||
          point.x > cssWidth + margin ||
          point.y > cssHeight + margin
        ) {
          continue;
        }

        projected.push({ station, x: point.x, y: point.y });

        // Every light always burns. There was a day/night model here that lit a
        // station only when its own sun was down; it was removed because the
        // point of this map is the rhythms, and someone opening it at midday
        // should see them rather than a dark coast.
        // Held at a steady glow when the viewer has asked for reduced motion:
        // every station still shows, at its own colour and position, it simply
        // does not pulse. The rhythm remains readable in the drawer's ribbon.
        const intensity = animate
          ? sampleAt(station.timeline, tMs, station.offsetMs).intensity
          : 0.7;

        const isSelected = station.id === selectedId;
        const isHovered = station.id === hoveredId;
        const emphasis = isSelected ? 1.55 : isHovered ? 1.25 : 1;
        const alpha = intensity;

        // --- the rotating sweep ---------------------------------------------
        //
        // A flashing character *is* an optic turning: the flash you see is the
        // beam passing you. So lights with a rotating character get real
        // sweeps, N panels turning once per period — the same model the 3D
        // tower uses, at the same clock time. Isophase, occulting and fixed
        // lights do not sweep, and correctly show only a pulsing glow.
        if (animate && station.rotating) {
          const sweep = sweeps[station.primaryColour];
          if (sweep) {
            const truePx = (rangeNm(station) * METRES_PER_NM) / metresPerPixel;
            const reach = Math.min(
              MAX_SWEEP_PX,
              Math.max(MIN_SWEEP_PX, truePx * rangeExaggeration(zoom)),
            );
            // Wrapped into a single revolution via `progressAt`, NOT computed
            // as `(tMs / period) * 2π`.
            //
            // `tMs` is wall-clock milliseconds, so that expression yields ~3.7
            // *billion* radians. Canvas 2D takes the angle as float32, where
            // the ULP at 3.7e9 is about 256 radians — so a frame's worth of
            // rotation (0.035 rad) is rounded clean away and the beams sit
            // perfectly still. Verified: `rotate(3.75e9)` and
            // `rotate(3.75e9 + 0.035)` render pixel-identical output.
            const spin = progressAt(station.timeline, tMs, station.offsetMs) * Math.PI * 2;

            ctx.save();
            ctx.translate(point.x, point.y);
            // Restrained on purpose: 65 stations each throwing up to five beams
            // will bury the coastline if each one is bright, and the chart has
            // to stay readable underneath them.
            ctx.globalAlpha = 0.32 * emphasis;
            for (let i = 0; i < station.panels; i += 1) {
              ctx.rotate(i === 0 ? spin : (Math.PI * 2) / station.panels);
              ctx.drawImage(sweep, -reach, -reach, reach * 2, reach * 2);
            }
            ctx.restore();
          }
        }

        const sprite = sprites[station.primaryColour];
        if (sprite && alpha > 0.01) {
          const size = GLOW_RADIUS * 2 * emphasis * (0.55 + 0.45 * alpha);
          ctx.globalAlpha = Math.min(1, alpha);
          ctx.drawImage(sprite, point.x - size / 2, point.y - size / 2, size, size);
        }

        // A small always-visible core, so an unlit station is still findable.
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, CORE_RADIUS * emphasis, 0, Math.PI * 2);
        ctx.fillStyle = LIGHT_COLOURS[station.primaryColour];
        ctx.globalAlpha = 0.25 + 0.75 * alpha;
        ctx.fill();
      }

      // Labels sit in normal compositing — additive text on a dark chart turns
      // to mush.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      const showAllLabels = zoom >= 7.4;

      for (const { station, x, y } of projected) {
        const isFocus = station.id === selectedId || station.id === hoveredId;
        if (!showAllLabels && !isFocus) continue;

        ctx.font = isFocus
          ? '600 12px "Martian Mono", ui-monospace, monospace'
          : '400 11px "Martian Mono", ui-monospace, monospace';
        ctx.textBaseline = 'middle';

        const label = station.name;
        const tx = x + 11;

        // A short ink pad behind the text keeps it legible over the glow.
        const metrics = ctx.measureText(label);
        ctx.fillStyle = 'rgba(5, 8, 13, 0.72)';
        ctx.fillRect(tx - 3, y - 8, metrics.width + 6, 16);

        ctx.fillStyle = isFocus ? '#ece2cc' : '#b3a892';
        ctx.fillText(label, tx, y);
      }

      ctx.globalAlpha = 1;
    };

    const unsubscribe = subscribe(draw);

    return () => {
      unsubscribe();
      map.off('resize', resize);
    };
  }, [map]);

  // --- pointer interaction ------------------------------------------------
  // Pointer Events rather than mouse events, because `mousemove` never fires on
  // a touch screen — the whole read-out was dead on a phone.
  //
  // Hit-testing reuses the positions computed during the last draw, so a pointer
  // move costs a short scan rather than 65 re-projections.
  useEffect(() => {
    const container = map.getContainer();
    const { hover, select } = useApp.getState();

    const nearest = (clientX: number, clientY: number, radius: number) => {
      const rect = container.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      const currentId = useApp.getState().hoveredId;

      let best: Station | null = null;
      let bestDistance = radius;
      let current: Station | null = null;
      let currentDistance = Infinity;

      for (const { station, x, y } of projectedRef.current) {
        const distance = Math.hypot(x - px, y - py);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = station;
        }
        if (station.id === currentId) {
          current = station;
          currentDistance = distance;
        }
      }

      // Stay on the station already under the pointer unless a rival is clearly
      // closer, so overlapping lights do not swap back and forth.
      if (current && currentDistance <= radius && currentDistance <= bestDistance * STICKY_FACTOR) {
        return current;
      }
      return best;
    };

    const radiusFor = (event: PointerEvent) =>
      event.pointerType === 'mouse' ? HIT_RADIUS_FINE : HIT_RADIUS_COARSE;

    // Hovering is a mouse-only idea; on touch the equivalent is the tap below.
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const station = nearest(event.clientX, event.clientY, HIT_RADIUS_FINE);
      const next = station?.id ?? null;
      if (next !== useApp.getState().hoveredId) hover(next);
      container.style.cursor = station ? 'pointer' : '';
    };

    // A tap is a pointerdown/up pair that neither moved far nor took long —
    // otherwise the gesture was a pan of the map and must not select anything.
    let down: { x: number; y: number; t: number } | null = null;

    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY, t: performance.now() };
    };

    const onUp = (event: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      const elapsed = performance.now() - down.t;
      down = null;
      if (moved > TAP_SLOP_PX || elapsed > TAP_TIMEOUT_MS) return;

      const station = nearest(event.clientX, event.clientY, radiusFor(event));
      if (station) {
        // Touch has no hover, so a tap must set both for the read-out to appear.
        hover(station.id);
        select(station.id);
      } else if (event.pointerType !== 'mouse') {
        // Tapping empty sea dismisses the read-out.
        hover(null);
        select(null);
      }
    };

    const onLeave = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') hover(null);
    };

    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', () => (down = null));
    container.addEventListener('pointerleave', onLeave);

    return () => {
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointerleave', onLeave);
    };
  }, [map]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-10"
      aria-hidden="true"
    />
  );
}
