/**
 * Types for the light-character engine.
 *
 * A light's "character" is the IALA code Irish Lights publishes for every station —
 * `Fl WR 3s`, `Fl (3) W 15s`, `Iso W 4s`, `Q (2) W 7.5s`. It is a complete timing
 * specification, and it is the reason this app can show real rhythms rather than
 * decorative blinking.
 *
 * The pipeline deliberately does NOT interpret these strings (see CLAUDE.md Rule 1):
 * the parser exists here, once, and nowhere else.
 */

/** The rhythm family of a light. */
export type LightForm =
  /** Fixed — continuous, no rhythm. */
  | 'F'
  /** Flashing — light shorter than dark. */
  | 'Fl'
  /** Long-flashing — a single flash of two seconds or more. */
  | 'LFl'
  /** Occulting — light *longer* than dark; the inverse of flashing. */
  | 'Oc'
  /** Isophase — equal light and dark. */
  | 'Iso'
  /** Quick — roughly 60 flashes a minute. */
  | 'Q'
  /** Very quick — roughly 120 a minute. */
  | 'VQ'
  /** Ultra quick — 240 or more a minute. */
  | 'UQ'
  /** Morse — the light spells a letter. */
  | 'Mo';

export type LightColour = 'white' | 'red' | 'green' | 'yellow';

/** A parsed light character. */
export interface CharacterSpec {
  /** The source string, verbatim and unmodified. */
  raw: string;
  form: LightForm;
  /**
   * Flashes (or eclipses) per group — the `3` in `Fl (3) W 15s`.
   * `null` means the light is not grouped.
   */
  group: number | null;
  /** The letter for a Morse character: the `A` in `Mo(A)`. */
  morseLetter: string | null;
  /**
   * Colours the light shows. More than one means it is sectored or has an
   * auxiliary light — which colour you actually see depends on your bearing.
   */
  colours: LightColour[];
  /**
   * True when the source named no colour and we defaulted to white, which is the
   * IALA convention. Four Irish stations publish characters like `Fl (2) 20s`.
   */
  colourAssumed: boolean;
  /** Period in milliseconds, or `null` when the source gives none (fixed lights). */
  periodMs: number | null;
  /** `Dir` prefix: a directional light, aimed along a single bearing. */
  directional: boolean;
  /**
   * Whatever followed the code — "Exhibited by day in conditions of poor
   * visibility", "24hr", "Night time only". Kept rather than discarded because it
   * is genuinely useful to a reader.
   */
  note: string | null;
  /** A second light described in the same field. Aranmore has one. */
  auxiliary: CharacterSpec | null;
  /** True when no leading code could be recognised at all. */
  unparsed: boolean;
}

/** One stretch of the rhythm: the light is either on or off for `ms`. */
export interface Phase {
  lit: boolean;
  ms: number;
}

/** A character expanded into one full period of phases. */
export interface Timeline {
  phases: Phase[];
  /** Always equals the sum of `phases`. */
  periodMs: number;
  /**
   * True when the published period could not accommodate the conventional flash
   * durations and the phases were compressed to fit. Worth surfacing rather than
   * hiding: it means our rendering of this light is a best effort.
   */
  compressed: boolean;
}

/** The state of a light at an instant. */
export interface LightSample {
  /** Whether this instant falls inside a lit phase. */
  lit: boolean;
  /**
   * 0–1, with short ramps at the edges of each flash so the light reads as an
   * optic sweeping past rather than a square wave.
   */
  intensity: number;
}
