/**
 * The chart itself.
 *
 * MapLibre owns the basemap and the camera; it does NOT own the lights. Those are
 * drawn by `LightOverlay` onto a canvas above this, because seventy DOM markers
 * animating at 60fps would thrash the compositor. See that file for the details.
 */

// MapLibre v6 has no default export — named imports only.
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type ErrorEvent } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

// `?worker&url` — NOT `?url`. See the note below; this distinction is the whole bug.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

/**
 * Tell MapLibre where its tile-parsing worker actually is.
 *
 * MapLibre v6 computes that URL at *runtime* from `import.meta.url`:
 *
 *     let e = import.meta.url;
 *     if (!/^https?:/.test(e)) return '';
 *     return new URL('./maplibre-gl-worker.mjs', e).href;
 *
 * Because it is built at runtime rather than written as a literal
 * `new URL(..., import.meta.url)`, Rollup cannot see it and never emits the
 * file. In a production build `import.meta.url` becomes the bundle's own URL,
 * so MapLibre requested `/assets/maplibre-gl-worker.mjs`, which did not exist,
 * fell through to the SPA's index.html, and was rejected for a `text/html`
 * MIME type. The basemap then silently never rendered — **in production only**,
 * which is exactly the kind of bug that ships.
 *
 * **It must be `?worker&url`, not `?url`.** `?url` copies the file byte-for-byte
 * and does not follow its imports — and `maplibre-gl-worker.mjs` is not
 * self-contained: it opens with
 * `import {...} from './maplibre-gl-shared.mjs'`, a 514 KB chunk that was never
 * emitted. The worker therefore 404'd on its own import and died silently.
 *
 * The symptom was subtle and worth recognising: the map *style* loads on the
 * main thread, so the background layer paints and `applyNightChart` runs — but
 * vector tiles are parsed in the worker, so no coastline ever appears. A
 * uniform land-coloured background with no geography means "the worker is
 * dead", not "the tiles are missing".
 *
 * `?worker&url` bundles the worker with its dependencies and returns the URL.
 */
setWorkerUrl(maplibreWorkerUrl);

import { applyNightChart } from '../lib/nightChart';
import { IRELAND_BOUNDS } from '../lib/stations';
import { LightOverlay } from './LightOverlay';
import { StationFlight } from './StationFlight';

/**
 * CARTO's dark basemap, no API key required. Labels are off because the chart
 * draws its own — the stock labels compete with the lights for attention, and
 * attention on the lights is the entire point.
 */
const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';

/**
 * Keep Ireland clear of the chrome drawn over the map.
 *
 * On a phone the masthead and controls occupy the top ~150px and the read-out
 * the bottom ~90px; fitting the bounds to the raw viewport puts the north coast
 * underneath the title. Padding the camera instead of shrinking the map means
 * the island still fills the space that is actually visible.
 */
function framePadding(width: number) {
  const narrow = width < 640;
  return narrow
    ? { top: 150, bottom: 90, left: 16, right: 16 }
    : { top: 130, bottom: 80, left: 60, right: 60 };
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const instance = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      bounds: IRELAND_BOUNDS,
      fitBoundsOptions: { padding: framePadding(containerRef.current.clientWidth) },
      minZoom: 4.5,
      maxZoom: 16,
      attributionControl: { compact: true },
      // The lights are drawn on a separate canvas that reads `map.project()`,
      // so the two must stay in lockstep during inertial panning.
      fadeDuration: 0,
    });

    instance.addControl(new NavigationControl({ showCompass: true }), 'bottom-right');

    // Publish the map instance IMMEDIATELY, not on 'load'.
    //
    // 'load' waits for the first tiles. When the tile CDN is unreachable it
    // never fires at all — and because the overlay was gated on it, a network
    // failure took out every light on the map, not merely the coastline. The
    // overlay needs only `map.project()`, which works off the camera transform
    // set from `bounds` at construction. The lights are the product; they must
    // outlive the basemap.
    setMap(instance);

    instance.on('style.load', () => applyNightChart(instance));

    let tileErrors = 0;
    instance.on('error', (e: ErrorEvent) => {
      const message = String(e.error?.message ?? '');
      // A handful of failed tiles is normal at the edges; a sustained run means
      // the basemap is genuinely unavailable and the viewer deserves to know.
      if (message.includes('style')) setFailed(true);
      else if (++tileErrors >= 4) setFailed(true);
    });

    // Re-frame when the layout crosses the phone/desktop breakpoint (rotation,
    // window resize), because the chrome that the padding compensates for
    // changes size. Skipped once the user has moved the map themselves —
    // yanking someone's view back to the whole island would be obnoxious.
    let userMoved = false;
    const markMoved = () => (userMoved = true);
    instance.on('dragstart', markMoved);
    instance.on('zoomstart', markMoved);

    let wasNarrow = instance.getContainer().clientWidth < 640;
    const onResize = () => {
      const width = instance.getContainer().clientWidth;
      const narrow = width < 640;
      if (narrow !== wasNarrow) {
        wasNarrow = narrow;
        if (!userMoved) {
          instance.fitBounds(IRELAND_BOUNDS, { padding: framePadding(width), duration: 0 });
        }
      }
    };
    instance.on('resize', onResize);

    return () => {
      setMap(null);
      instance.remove();
    };
  }, []);

  return (
    <div className="absolute inset-0">
      {/* h-full rather than `absolute inset-0`: maplibre-gl.css sets
          `position: relative` on .maplibregl-map once the map mounts, which
          overrides absolute positioning, leaves top/bottom unconstrained and
          collapses the container to zero height. */}
      <div ref={containerRef} className="h-full w-full" />
      {map ? <LightOverlay map={map} /> : null}
      {map ? <StationFlight map={map} /> : null}

      {failed ? (
        <div className="pointer-events-none absolute inset-x-0 top-24 mx-auto max-w-sm px-6">
          <p className="chart-caveat bg-ink-900/90 px-4 py-3">
            <strong>The coastline could not load.</strong> Every light&rsquo;s position and
            rhythm is still accurate — only the map behind them is missing.
          </p>
        </div>
      ) : null}
    </div>
  );
}
