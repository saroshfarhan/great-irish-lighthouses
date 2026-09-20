/**
 * The dataset, enriched once at module load.
 *
 * Parsing a character and expanding its timeline is pure work that never changes,
 * so it happens exactly once for all 65 stations here rather than 65 times per
 * frame in the render loop. At 60fps that is the difference between ~4,000
 * parses a second and none.
 */

import lighthousesJson from '../data/lighthouses.json';
import type { Lighthouse, Tower } from '../data/schema.gen';
import { isRotating, panelCount } from './character/optic';
import { parseCharacter } from './character/parse';
import { phaseOffsetMs } from './character/sample';
import { buildTimeline } from './character/timeline';
import type { CharacterSpec, LightColour, Timeline } from './character/types';

/**
 * `tower` is optional in the generated schema because the pydantic model gives
 * it a default, but `build_dataset.py` emits it for all 65 stations. Making it
 * required here — and filling it once in `enrich` — keeps the 3D code free of
 * defensive `?.` on a field that is always present.
 */
export interface Station extends Omit<Lighthouse, 'tower'> {
  tower: Tower;
  spec: CharacterSpec;
  timeline: Timeline;
  /** Stable per-station phase offset — see `phaseOffsetMs` for why. */
  offsetMs: number;
  /**
   * The colour to draw on the map. Sectored lights show different colours on
   * different bearings and cannot be reduced to one honestly, so we take the
   * first published colour and the drawer shows the full sector picture.
   */
  primaryColour: LightColour;
  /**
   * Every colour this light shows, across all its sectors.
   *
   * Distinct from `primaryColour`, and the one to filter on: a `Fl (2) WRG 10s`
   * light is a green light to anyone standing in its green sector, so counting
   * it as white-only reports zero green lights on a coast that has several.
   */
  allColours: LightColour[];
  /** True when this light shows more than one colour by sector. */
  sectored: boolean;
  /** Whether the light comes from a turning optic — see `character/optic.ts`. */
  rotating: boolean;
  /** Beams the optic throws; `Fl (3)` is three panels on one rotation. */
  panels: number;
}

/** CSS colours for each light colour, matching the tokens in theme.css. */
export const LIGHT_COLOURS: Record<LightColour, string> = {
  white: '#fff4d6',
  red: '#ff473a',
  green: '#2fd672',
  yellow: '#ffcf47',
};

/** Matches the height-derived fallback in build_dataset.py's `default_tower`. */
const FALLBACK_TOWER: Tower = {
  shape: 'tapered',
  body_colour: '#d8d5ce',
  bands: [],
  lantern_colour: '#6e7176',
  gallery_colour: '#6e7176',
  galleries: 1,
  has_dwelling: false,
  is_default: true,
  evidence: 'default',
};

function enrich(lh: Lighthouse): Station {
  const spec = parseCharacter(lh.character.raw);
  const timeline = buildTimeline(spec);
  return {
    ...lh,
    tower: lh.tower ?? FALLBACK_TOWER,
    spec,
    timeline,
    offsetMs: phaseOffsetMs(lh.id, timeline.periodMs),
    primaryColour: spec.colours[0] ?? 'white',
    allColours: spec.colours.length > 0 ? spec.colours : ['white'],
    sectored: spec.colours.length > 1,
    rotating: isRotating(spec),
    panels: panelCount(spec),
  };
}

export const stations: Station[] = (lighthousesJson as unknown as Lighthouse[]).map(enrich);

export const stationsById = new Map(stations.map((s) => [s.id, s]));

/** Ireland, with enough margin to frame the offshore rocks. */
export const IRELAND_BOUNDS: [[number, number], [number, number]] = [
  [-11.2, 51.2],
  [-5.2, 55.6],
];
