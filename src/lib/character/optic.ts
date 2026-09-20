/**
 * What kind of optic produces a given character.
 *
 * This lives here, once, because two very different renderers need the same
 * answer: the 3D beam and the map's sweep. If they disagreed about whether a
 * light rotates — or about how many panels it has — the tower and the dot
 * representing it would show different lights. Same reasoning as the parser
 * itself (CLAUDE.md Rule 1).
 */

import type { CharacterSpec, LightForm } from './types';

/**
 * Forms produced by a turning optic.
 *
 * A flashing character is not a lamp switching on and off: it is a lens
 * assembly rotating, and the flash is one panel sweeping past the observer.
 * Isophase, occulting and fixed lights do not turn — occulting is a fixed lamp
 * briefly screened — so they must not be drawn as sweeps.
 */
const ROTATING_FORMS: ReadonlySet<LightForm> = new Set<LightForm>(['Fl', 'LFl', 'Q', 'VQ', 'UQ']);

export function isRotating(spec: CharacterSpec): boolean {
  return !spec.unparsed && ROTATING_FORMS.has(spec.form);
}

/**
 * How many beams the optic throws.
 *
 * `Fl (3) W 15s` is three panels turning once every fifteen seconds — which is
 * *why* it flashes three times. Modelling it this way means the rhythm emerges
 * from the geometry rather than being animated on top of it.
 */
export function panelCount(spec: CharacterSpec): number {
  if (!isRotating(spec)) return 0;
  return Math.max(1, spec.group ?? 1);
}
