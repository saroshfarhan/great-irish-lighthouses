import { describe, expect, it } from 'vitest';

import lighthousesJson from '../../data/lighthouses.json';
import type { Lighthouse } from '../../data/schema.gen';
import { parseCharacter } from './parse';
import { sampleAt, phaseOffsetMs, progressAt } from './sample';
import { buildTimeline } from './timeline';

const lighthouses = lighthousesJson as unknown as Lighthouse[];

/** Convenience: string -> timeline. */
const timelineOf = (raw: string) => buildTimeline(parseCharacter(raw));

describe('parseCharacter — forms and shapes', () => {
  it.each([
    ['Fl W 5s', { form: 'Fl', group: null, colours: ['white'], periodMs: 5000 }],
    ['Fl WR 3s', { form: 'Fl', group: null, colours: ['white', 'red'], periodMs: 3000 }],
    ['Fl (3) W 15s', { form: 'Fl', group: 3, colours: ['white'], periodMs: 15000 }],
    ['Iso W 4s', { form: 'Iso', group: null, colours: ['white'], periodMs: 4000 }],
    ['Oc W 3s', { form: 'Oc', group: null, colours: ['white'], periodMs: 3000 }],
    ['LFl WR 8s', { form: 'LFl', group: null, colours: ['white', 'red'], periodMs: 8000 }],
    ['Q (2) W 7.5s', { form: 'Q', group: 2, colours: ['white'], periodMs: 7500 }],
    ['Fl (2) WRG 10s', { form: 'Fl', group: 2, colours: ['white', 'red', 'green'] }],
  ])('parses %s', (raw, expected) => {
    expect(parseCharacter(raw)).toMatchObject(expected);
  });
});

describe('parseCharacter — the awkward real-world spellings', () => {
  it('accepts an upper-case form (Buncrana, Donaghadee)', () => {
    expect(parseCharacter('ISO WR 4s')).toMatchObject({ form: 'Iso', periodMs: 4000 });
  });

  it('accepts no space after the form (Inishowen)', () => {
    expect(parseCharacter('Fl(2) WRG 10s.')).toMatchObject({ form: 'Fl', group: 2 });
  });

  it('accepts no space before the colour (Slyne Head)', () => {
    expect(parseCharacter('Fl (2)W 15s')).toMatchObject({
      form: 'Fl',
      group: 2,
      colours: ['white'],
      periodMs: 15000,
    });
  });

  it('accepts a space inside the period (Muglins)', () => {
    expect(parseCharacter('Fl R 5 s')).toMatchObject({ colours: ['red'], periodMs: 5000 });
  });

  it('accepts "secs" and keeps the trailing prose (Tory Island)', () => {
    const spec = parseCharacter('Fl (4) W 30 secs, Night time only');
    expect(spec).toMatchObject({ form: 'Fl', group: 4, periodMs: 30_000 });
    expect(spec.note).toBe('Night time only');
  });

  it('defaults an unqualified light to white (Kish Bank)', () => {
    const spec = parseCharacter('Fl (2) 20s. 24 hour light');
    expect(spec.colours).toEqual(['white']);
    expect(spec.colourAssumed).toBe(true);
    expect(spec.periodMs).toBe(20_000);
  });

  it('records a directional prefix (Castletown)', () => {
    expect(parseCharacter('Dir Oc WRG 5s (24 hours)')).toMatchObject({
      directional: true,
      form: 'Oc',
      colours: ['white', 'red', 'green'],
    });
  });

  it('keeps the daytime note rather than choking on it (Roches Point)', () => {
    const spec = parseCharacter('Fl WR 3s. Exhibited by day in conditons of poor visibility');
    expect(spec.periodMs).toBe(3000);
    expect(spec.note).toMatch(/Exhibited by day/);
  });

  it('parses the auxiliary light as a second character (Aranmore)', () => {
    const spec = parseCharacter('Fl (2) W 20s. Auxiliary Light Fl R 3s over Rinrawros Point');
    expect(spec).toMatchObject({ form: 'Fl', group: 2, periodMs: 20_000 });
    expect(spec.auxiliary).toMatchObject({ form: 'Fl', colours: ['red'], periodMs: 3000 });
  });

  it('understands the legacy "Gp Fl" notation', () => {
    expect(parseCharacter('Gp Fl (2) WRG 10s')).toMatchObject({ form: 'Fl', group: 2 });
  });

  it('does not mistake Fl for a fixed light', () => {
    expect(parseCharacter('Fl W 5s').form).toBe('Fl');
    expect(parseCharacter('F R').form).toBe('F');
  });

  it('degrades safely on nonsense instead of throwing', () => {
    const spec = parseCharacter('under review');
    expect(spec.unparsed).toBe(true);
    expect(spec.note).toBe('under review');
  });
});

describe('buildTimeline — phases must sum exactly to the period', () => {
  it.each([
    'Fl W 5s',
    'Fl (3) W 15s',
    'Fl (5) W 20s',
    'Iso W 4s',
    'Oc W 5s',
    'Q (2) W 7.5s',
    'LFl W 10s',
    'Fl W 2.5s',
    'Fl (4) W 30s',
  ])('%s', (raw) => {
    const tl = timelineOf(raw);
    const total = tl.phases.reduce((sum, p) => sum + p.ms, 0);
    expect(total).toBeCloseTo(tl.periodMs, 6);
  });
});

describe('buildTimeline — the rhythm is actually right', () => {
  it('Fl (3) W 15s gives exactly three flashes in fifteen seconds', () => {
    const tl = timelineOf('Fl (3) W 15s');
    expect(tl.phases.filter((p) => p.lit)).toHaveLength(3);
    expect(tl.periodMs).toBe(15_000);
  });

  it('Fl (5) W 20s gives exactly five', () => {
    expect(timelineOf('Fl (5) W 20s').phases.filter((p) => p.lit)).toHaveLength(5);
  });

  it('Iso W 4s is two seconds lit and two dark', () => {
    const tl = timelineOf('Iso W 4s');
    expect(tl.phases).toEqual([
      { lit: true, ms: 2000 },
      { lit: false, ms: 2000 },
    ]);
  });

  it('occulting is lit longer than it is dark — the inverse of flashing', () => {
    const oc = timelineOf('Oc W 5s');
    const lit = oc.phases.filter((p) => p.lit).reduce((s, p) => s + p.ms, 0);
    const dark = oc.phases.filter((p) => !p.lit).reduce((s, p) => s + p.ms, 0);
    expect(lit).toBeGreaterThan(dark);

    const fl = timelineOf('Fl W 5s');
    const flLit = fl.phases.filter((p) => p.lit).reduce((s, p) => s + p.ms, 0);
    const flDark = fl.phases.filter((p) => !p.lit).reduce((s, p) => s + p.ms, 0);
    expect(flLit).toBeLessThan(flDark);
  });

  it('a long flash lasts at least two seconds, by definition', () => {
    const tl = timelineOf('LFl W 10s');
    const longest = Math.max(...tl.phases.filter((p) => p.lit).map((p) => p.ms));
    expect(longest).toBeGreaterThanOrEqual(2000);
  });

  it('compresses rather than producing a negative eclipse on an impossible period', () => {
    // Five conventional flashes need 6.5s; this claims 3s.
    const tl = timelineOf('Fl (5) W 3s');
    expect(tl.compressed).toBe(true);
    expect(tl.phases.every((p) => p.ms > 0)).toBe(true);
    expect(tl.phases.reduce((s, p) => s + p.ms, 0)).toBeCloseTo(3000, 6);
  });
});

describe('sampleAt', () => {
  const tl = timelineOf('Fl (3) W 15s');

  it('intensity is continuous across the period wrap', () => {
    // `lit` legitimately flips here — Fl (3) W 15s begins with a flash at t=0, so
    // the period ends dark and restarts lit. That is the rhythm, not a bug.
    //
    // What must NOT jump is intensity: it is the value actually rendered, and a
    // step change would make every light on the map stutter once per cycle. The
    // edge ramp in sample.ts exists precisely so the flash rises from the dark
    // floor rather than snapping on.
    const before = sampleAt(tl, tl.periodMs - 1);
    const after = sampleAt(tl, 0);
    expect(Math.abs(before.intensity - after.intensity)).toBeLessThan(0.05);
  });

  it('intensity never steps sharply anywhere in the period', () => {
    // Sweep the whole period and assert no single millisecond causes a visible
    // jump. This is the general form of the wrap test above.
    let previous = sampleAt(tl, 0).intensity;
    for (let t = 1; t <= tl.periodMs; t += 1) {
      const current = sampleAt(tl, t).intensity;
      expect(Math.abs(current - previous), `step at t=${t}ms`).toBeLessThan(0.05);
      previous = current;
    }
  });

  it('handles negative time, for a scrubber running backwards', () => {
    expect(() => sampleAt(tl, -12_345)).not.toThrow();
    const s = sampleAt(tl, -12_345);
    expect(s.intensity).toBeGreaterThanOrEqual(0);
    expect(s.intensity).toBeLessThanOrEqual(1);
  });

  it('keeps intensity within 0..1 across a whole period', () => {
    for (let t = 0; t < tl.periodMs; t += 37) {
      const s = sampleAt(tl, t);
      expect(s.intensity).toBeGreaterThanOrEqual(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('is lit for a plausible fraction of a flashing light', () => {
    let litSamples = 0;
    const steps = 1500;
    for (let i = 0; i < steps; i += 1) {
      if (sampleAt(tl, (i / steps) * tl.periodMs).lit) litSamples += 1;
    }
    const fraction = litSamples / steps;
    // Three 0.5s flashes in 15s = 10%.
    expect(fraction).toBeGreaterThan(0.05);
    expect(fraction).toBeLessThan(0.2);
  });

  it('progress runs 0 -> 1 across the period', () => {
    expect(progressAt(tl, 0)).toBeCloseTo(0, 5);
    expect(progressAt(tl, tl.periodMs / 2)).toBeCloseTo(0.5, 5);
    expect(progressAt(tl, tl.periodMs * 0.999)).toBeGreaterThan(0.99);
  });

  it('progress stays inside one revolution even at wall-clock times', () => {
    // This guards a bug that froze every rotating beam on the map.
    //
    // The obvious way to get a rotation angle is `(tMs / period) * 2π`, but
    // `tMs` is wall-clock milliseconds (~1.79e12), which yields ~3.7 *billion*
    // radians. Canvas 2D takes the angle as float32, where the ULP up there is
    // ~256 radians, so a frame's worth of rotation (0.035 rad) rounds away
    // entirely and the beams sit perfectly still.
    //
    // `progressAt` must therefore always return 0..1, and must still advance
    // between consecutive frames at realistic timestamps.
    const wallClock = 1_789_000_000_000;

    for (const raw of ['Fl W 3s', 'Fl (3) W 15s', 'Fl (4) W 30s', 'Q (2) W 7.5s']) {
      const tl = timelineOf(raw);

      const p = progressAt(tl, wallClock);
      expect(p, raw).toBeGreaterThanOrEqual(0);
      expect(p, raw).toBeLessThan(1);

      // One frame later the angle must actually have moved.
      const next = progressAt(tl, wallClock + 16.7);
      expect(Math.abs(next - p), `${raw} did not advance`).toBeGreaterThan(0);

      // And the derived angle must stay within a single revolution, which is
      // the property that keeps it in float32's precise range.
      expect(p * Math.PI * 2).toBeLessThan(Math.PI * 2);
    }
  });

  it('gives each station a stable offset inside its period', () => {
    for (const id of ['fastnet', 'hook-head', 'baily']) {
      const offset = phaseOffsetMs(id, 15_000);
      expect(offset).toBe(phaseOffsetMs(id, 15_000));
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(15_000);
    }
    expect(phaseOffsetMs('fastnet', 15_000)).not.toBe(phaseOffsetMs('hook-head', 15_000));
  });
});

// ---------------------------------------------------------------------------
// The test that matters most: the engine against every character Irish Lights
// actually publishes. Synthetic cases prove the grammar; this proves the data.
// ---------------------------------------------------------------------------

describe('the real dataset', () => {
  it('has stations to test', () => {
    expect(lighthouses.length).toBeGreaterThan(60);
  });

  it('parses every published character', () => {
    const failures = lighthouses
      .filter((lh) => parseCharacter(lh.character.raw).unparsed)
      .map((lh) => `${lh.id}: ${lh.character.raw}`);
    expect(failures).toEqual([]);
  });

  it('produces a usable period for every station', () => {
    const bad = lighthouses
      .map((lh) => ({ id: lh.id, tl: timelineOf(lh.character.raw) }))
      .filter(({ tl }) => !(tl.periodMs > 0) || tl.phases.length === 0)
      .map(({ id }) => id);
    expect(bad).toEqual([]);
  });

  it('builds timelines whose phases sum exactly to their period', () => {
    for (const lh of lighthouses) {
      const tl = timelineOf(lh.character.raw);
      const total = tl.phases.reduce((sum, p) => sum + p.ms, 0);
      expect(total, `${lh.id} (${lh.character.raw})`).toBeCloseTo(tl.periodMs, 6);
    }
  });

  it('never needs to compress a real published character', () => {
    // If this fails, a genuine Irish Lights period cannot accommodate the
    // conventional flash durations, and the constants in timeline.ts deserve
    // another look rather than a silent squeeze.
    const compressed = lighthouses
      .filter((lh) => timelineOf(lh.character.raw).compressed)
      .map((lh) => `${lh.id}: ${lh.character.raw}`);
    expect(compressed).toEqual([]);
  });

  it('every station flashes at least once per period, and is not permanently lit', () => {
    for (const lh of lighthouses) {
      const spec = parseCharacter(lh.character.raw);
      if (spec.form === 'F') continue; // fixed lights are legitimately always on
      const tl = buildTimeline(spec);
      expect(tl.phases.some((p) => p.lit), `${lh.id} never lights`).toBe(true);
      expect(tl.phases.some((p) => !p.lit), `${lh.id} never goes dark`).toBe(true);
    }
  });
});
