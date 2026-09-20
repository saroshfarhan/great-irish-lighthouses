// GENERATED FILE — DO NOT EDIT.
//
// Produced by src/scripts/gen_types.py from the pydantic models in build_dataset.py,
// which are the single source of truth for the dataset's shape. To change a field,
// edit the model and re-run:
//
//     uv run src/scripts/gen_types.py
//
// Pipeline revision at generation: unversioned

export interface Position {
  lat: number;
  lon: number;
  raw: string;
  cross_check_delta_m?: number | null;
}

export interface LightCharacter {
  raw: string;
}

export interface LightRange {
  colour: string | null;
  nautical_miles: number;
  qualifier?: string | null;
}

/** One arc of bearings from the source's "Sectors" field. */
export interface Arc {
  kind: string;
  colour?: string | null;
  from_deg?: number | null;
  to_deg?: number | null;
  from_shore?: boolean;
  to_shore?: boolean;
  width_deg?: number | null;
  qualifier?: string | null;
}

/** A painted band, as a fraction of tower height from the base. */
export interface Band {
  colour: string;
  from_frac: number;
  to_frac: number;
}

/** Visual attributes for the 3D generator. */
export interface Tower {
  shape?: string;
  body_colour?: string;
  bands?: Band[];
  lantern_colour?: string;
  gallery_colour?: string;
  galleries?: number;
  has_dwelling?: boolean;
  is_default?: boolean;
  evidence?: string;
}

export interface Lighthouse {
  id: string;
  name: string;
  source_url: string;
  coast: string;
  position: Position;
  character: LightCharacter;
  sectors_raw?: string | null;
  sectors?: Arc[];
  range_raw: string;
  ranges?: LightRange[];
  tower_height_m?: number | null;
  light_height_m?: number | null;
  radar_beacon?: string | null;
  ais?: string | null;
  has_history?: boolean;
  photos?: string[];
  tower?: Tower;
  data_notes?: string[];
}

/** The shipped dataset: src/data/lighthouses.json */
export type LighthouseDataset = Lighthouse[];

/** Lazily fetched prose, keyed by lighthouse id: src/data/histories.json */
export type HistoryIndex = Record<string, string>;
