/**
 * Sample a timeline at an instant.
 *
 * This is the function every renderer shares. The map's glow, the 3D beam and the
 * character ribbon's playhead all call it with the same `t`, which is why they
 * cannot drift apart — there is one answer to "is this light on right now", not
 * three implementations that agree by luck.
 *
 * It is called roughly 65 times per frame, so it allocates nothing and does no work
 * beyond a modulo and a short scan.
 */

import type { LightSample, Timeline } from './types';

/**
 * Ramp at the edge of each flash, so a light reads as an optic rotating past
 * rather than a bulb switching. Capped at a third of the phase so very short
 * quick-flashes still reach full brightness.
 */
const EDGE_RAMP_MS = 110;

/** Baseline glow for an unlit light, so stations stay findable on a dark chart. */
export const DARK_INTENSITY = 0.06;

/**
 * Where in its period a station sits at time `t`.
 *
 * Real-world phase is not published — Irish Lights does not say which second a
 * given flash falls on — so we derive a stable per-station offset from its id.
 * This is honest about being arbitrary while guaranteeing the coast does not blink
 * in unison, which would look wrong and would misrepresent the data just as much.
 */
export function phaseOffsetMs(id: string, periodMs: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % Math.max(1, Math.round(periodMs));
}

/**
 * The state of a light at `tMs`.
 *
 * @param timeline phases summing exactly to `timeline.periodMs`
 * @param tMs      milliseconds on the shared clock; may exceed the period
 * @param offsetMs per-station phase offset from {@link phaseOffsetMs}
 */
export function sampleAt(timeline: Timeline, tMs: number, offsetMs = 0): LightSample {
  const { phases, periodMs } = timeline;

  if (periodMs <= 0 || phases.length === 0) {
    return { lit: true, intensity: 1 };
  }

  // Positive modulo: `tMs` can legitimately be negative if the clock is ever
  // set backwards, and a negative index would fall off the front of the scan.
  let t = (tMs + offsetMs) % periodMs;
  if (t < 0) t += periodMs;

  let elapsed = 0;
  for (let i = 0; i < phases.length; i += 1) {
    const p = phases[i]!;
    const end = elapsed + p.ms;

    if (t < end) {
      if (!p.lit) return { lit: false, intensity: DARK_INTENSITY };

      const into = t - elapsed;
      const remaining = end - t;
      const ramp = Math.min(EDGE_RAMP_MS, p.ms / 3);

      let intensity = 1;
      if (ramp > 0) {
        if (into < ramp) intensity = into / ramp;
        else if (remaining < ramp) intensity = remaining / ramp;
      }

      // Ease the ramp so the rise and fall look like a beam sweeping rather than
      // a linear fade.
      intensity = intensity * intensity * (3 - 2 * intensity);

      return { lit: true, intensity: DARK_INTENSITY + (1 - DARK_INTENSITY) * intensity };
    }

    elapsed = end;
  }

  // Only reachable through floating-point drift at the very end of a period.
  const last = phases[phases.length - 1]!;
  return last.lit ? { lit: true, intensity: 1 } : { lit: false, intensity: DARK_INTENSITY };
}

/** Fraction through the period, 0–1. Drives the character ribbon's playhead. */
export function progressAt(timeline: Timeline, tMs: number, offsetMs = 0): number {
  if (timeline.periodMs <= 0) return 0;
  let t = (tMs + offsetMs) % timeline.periodMs;
  if (t < 0) t += timeline.periodMs;
  return t / timeline.periodMs;
}
