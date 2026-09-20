/**
 * Restyle the stock basemap into the Night Chart.
 *
 * CARTO's dark-matter is a good dark basemap but it is built for cities: land is
 * the dark field, water is *lighter* than it, and the whole road network is drawn.
 * For a map of navigational aids that is backwards on both counts — on a sea
 * chart the water is the field, and roads are noise that competes with the one
 * thing the viewer is meant to look at.
 *
 * So after the style loads we invert the land/water relationship and strip the
 * land detail. Doing it by recolouring the loaded style, rather than authoring a
 * whole style document, keeps us on CARTO's tile schema and means the map still
 * works if they change their layer palette.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';

/** Must match the tokens in styles/theme.css. */
const SEA = '#05080d'; // ink-950 — the darkest thing on screen
const LAND = '#141c28'; // a touch above ink-800, so the coastline reads
const COASTLINE = '#2b3a4f';
const BOUNDARY = '#1b2634';

/**
 * Layer id fragments that carry land detail we do not want. Matched as
 * substrings because the style has dozens of near-identical road layers
 * (`road_pri_case`, `tunnel_mot_fill`, `bridge_sec_case`, …).
 */
const CLUTTER = [
  'road',
  'tunnel',
  'bridge',
  'aeroway',
  'building',
  'landuse',
  'park',
  'landcover',
  'rail',
  'pier',
  'ferry',
];

export function applyNightChart(map: MapLibreMap): void {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    const id = layer.id;

    try {
      if (layer.type === 'background') {
        // In dark-matter the background *is* the land.
        map.setPaintProperty(id, 'background-color', LAND);
        continue;
      }

      if (id.includes('water')) {
        if (layer.type === 'fill') {
          map.setPaintProperty(id, 'fill-color', SEA);
          map.setPaintProperty(id, 'fill-opacity', 1);
        } else if (layer.type === 'line') {
          map.setPaintProperty(id, 'line-color', SEA);
        }
        continue;
      }

      if (id.includes('boundary')) {
        map.setPaintProperty(id, 'line-color', BOUNDARY);
        map.setPaintProperty(id, 'line-opacity', 0.5);
        continue;
      }

      if (CLUTTER.some((fragment) => id.includes(fragment))) {
        map.setLayoutProperty(id, 'visibility', 'none');
      }
    } catch {
      // A layer that does not accept a property is not worth failing over —
      // the map is still perfectly usable with one layer left as it was.
    }
  }

  // A hairline where land meets sea. The coast is the subject of this map, so it
  // is the one piece of linework worth drawing deliberately.
  if (!map.getLayer('night-chart-coastline') && map.getSource('carto')) {
    try {
      map.addLayer({
        id: 'night-chart-coastline',
        type: 'line',
        source: 'carto',
        'source-layer': 'water',
        paint: {
          'line-color': COASTLINE,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 10, 1.2],
          'line-opacity': 0.7,
        },
      });
    } catch {
      // Source layer naming differs between vendors; the map reads fine without it.
    }
  }
}
