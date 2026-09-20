/**
 * Expand a parsed character into one period of lit/dark phases.
 *
 * WHAT IS FACT AND WHAT IS CONVENTION — read this before changing any number below.
 *
 * Exact, straight from the source:
 *   - the period (`15s` means the whole pattern repeats every 15 seconds)
 *   - the group count (`Fl (3)` means three flashes per period)
 *   - the form (flashing vs occulting vs isophase)
 *
 * Convention, chosen here:
 *   - how long each individual flash lasts, and the gap between flashes within a
 *     group. Irish Lights does not publish these, and in reality they vary with the
 *     optic. The values below are the standard IALA figures used on charts.
 *
 * So: a viewer counting three flashes per fifteen seconds is seeing the truth. A
 * viewer timing one flash with a stopwatch is seeing our convention. The distinction
 * is surfaced in the UI rather than glossed over.
 */

import type { CharacterSpec, Phase, Timeline } from './types';

// --- the conventional durations, in milliseconds ----------------------------

/** A standard flash. */
const FLASH_MS = 500;
/** A long flash is two seconds or more by definition. */
const LONG_FLASH_MS = 2000;
/** Dark gap between flashes inside one group. */
const GROUP_GAP_MS = 1000;
/** A standard eclipse in an occulting light. */
const OCCULT_MS = 1000;
/** Quick: 60 a minute. Very quick: 120. Ultra quick: 240. */
const QUICK_CYCLE_MS = 1000;
const VERY_QUICK_CYCLE_MS = 500;
const ULTRA_QUICK_CYCLE_MS = 250;
/** Lit fraction of one quick cycle. */
const QUICK_DUTY = 0.3;

/** Period assumed when a light publishes none (a fixed light still needs a clock). */
const DEFAULT_PERIOD_MS = 4000;

/** Morse, enough to cover the letters used as light characters. */
const MORSE: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  K: '-.-',
  N: '-.',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
};
const MORSE_DOT_MS = 400;
const MORSE_DASH_MS = 1200;
const MORSE_GAP_MS = 400;

function phase(lit: boolean, ms: number): Phase {
  return { lit, ms };
}

/** Merge adjacent phases of the same state and drop zero-length ones. */
function tidy(phases: Phase[]): Phase[] {
  const out: Phase[] = [];
  for (const p of phases) {
    if (p.ms <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.lit === p.lit) last.ms += p.ms;
    else out.push({ ...p });
  }
  return out;
}

/**
 * Force a set of phases to sum to exactly `periodMs`.
 *
 * Two jobs. When the pattern is shorter than the period, the remainder becomes
 * darkness (the eclipse) — which is the normal case. When the pattern is *longer*
 * than the period, the published period cannot fit the conventional durations, so
 * everything is scaled down proportionally and the timeline is flagged
 * `compressed`. Without this, a short-period group light would produce a negative
 * eclipse and the rhythm would run backwards.
 */
function fitToPeriod(phases: Phase[], periodMs: number): Timeline {
  const tidied = tidy(phases);
  const total = tidied.reduce((sum, p) => sum + p.ms, 0);

  if (total === periodMs) {
    return { phases: tidied, periodMs, compressed: false };
  }

  if (total < periodMs) {
    const withEclipse = tidy([...tidied, phase(false, periodMs - total)]);
    return { phases: withEclipse, periodMs, compressed: false };
  }

  const scale = periodMs / total;
  const scaled = tidied.map((p) => phase(p.lit, p.ms * scale));

  // Absorb floating-point drift into the last phase so the sum is exact — the
  // clock relies on phases summing precisely to the period.
  const scaledTotal = scaled.reduce((sum, p) => sum + p.ms, 0);
  const last = scaled[scaled.length - 1];
  if (last) last.ms += periodMs - scaledTotal;

  return { phases: scaled, periodMs, compressed: true };
}

/** `n` flashes of `flashMs`, separated by `gapMs` of darkness. */
function flashGroup(count: number, flashMs: number, gapMs: number): Phase[] {
  const phases: Phase[] = [];
  for (let i = 0; i < count; i += 1) {
    phases.push(phase(true, flashMs));
    if (i < count - 1) phases.push(phase(false, gapMs));
  }
  return phases;
}

function quickPhases(count: number | null, cycleMs: number, periodMs: number): Phase[] {
  const lit = cycleMs * QUICK_DUTY;
  const dark = cycleMs - lit;

  // A grouped quick light shows `count` rapid flashes, then a long eclipse.
  // An ungrouped one flashes continuously for the whole period.
  const cycles = count ?? Math.max(1, Math.round(periodMs / cycleMs));
  const phases: Phase[] = [];
  for (let i = 0; i < cycles; i += 1) {
    phases.push(phase(true, lit), phase(false, dark));
  }
  return phases;
}

function morsePhases(letter: string): Phase[] {
  const code = MORSE[letter.toUpperCase()];
  if (!code) return [phase(true, FLASH_MS)];

  const phases: Phase[] = [];
  for (let i = 0; i < code.length; i += 1) {
    phases.push(phase(true, code[i] === '-' ? MORSE_DASH_MS : MORSE_DOT_MS));
    if (i < code.length - 1) phases.push(phase(false, MORSE_GAP_MS));
  }
  return phases;
}

/**
 * Build one period of phases from a parsed character.
 *
 * The returned phases always sum exactly to `periodMs`, which is what lets the
 * shared clock index into them by `t % periodMs` without drift.
 */
export function buildTimeline(spec: CharacterSpec): Timeline {
  const periodMs = spec.periodMs ?? DEFAULT_PERIOD_MS;

  // An unrecognised character animates as a steady light rather than a dark one:
  // the station exists and is lit, we simply cannot render its rhythm.
  if (spec.unparsed) {
    return { phases: [phase(true, periodMs)], periodMs, compressed: false };
  }

  const group = spec.group;

  switch (spec.form) {
    case 'F':
      return { phases: [phase(true, periodMs)], periodMs, compressed: false };

    case 'Iso':
      // Equal light and dark, by definition.
      return fitToPeriod([phase(true, periodMs / 2)], periodMs);

    case 'Fl':
      return fitToPeriod(flashGroup(group ?? 1, FLASH_MS, GROUP_GAP_MS), periodMs);

    case 'LFl':
      return fitToPeriod(flashGroup(group ?? 1, LONG_FLASH_MS, GROUP_GAP_MS), periodMs);

    case 'Oc': {
      // Occulting is flashing inverted: the light is on, and briefly goes out.
      // The eclipses sit at the start and the remainder is lit, so `fitToPeriod`
      // appends darkness — which would be wrong here. Build it explicitly.
      const count = group ?? 1;
      const eclipses: Phase[] = [];
      for (let i = 0; i < count; i += 1) {
        eclipses.push(phase(false, OCCULT_MS));
        if (i < count - 1) eclipses.push(phase(true, GROUP_GAP_MS));
      }
      const used = eclipses.reduce((sum, p) => sum + p.ms, 0);
      if (used >= periodMs) return fitToPeriod(eclipses, periodMs);
      return fitToPeriod([phase(true, periodMs - used), ...eclipses], periodMs);
    }

    case 'Q':
      return fitToPeriod(quickPhases(group, QUICK_CYCLE_MS, periodMs), periodMs);

    case 'VQ':
      return fitToPeriod(quickPhases(group, VERY_QUICK_CYCLE_MS, periodMs), periodMs);

    case 'UQ':
      return fitToPeriod(quickPhases(group, ULTRA_QUICK_CYCLE_MS, periodMs), periodMs);

    case 'Mo':
      return fitToPeriod(morsePhases(spec.morseLetter ?? 'A'), periodMs);

    default:
      return { phases: [phase(true, periodMs)], periodMs, compressed: false };
  }
}
