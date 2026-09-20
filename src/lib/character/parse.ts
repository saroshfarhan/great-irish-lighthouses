/**
 * Parse an IALA light character into a structured spec.
 *
 * This parser is written against the 57 distinct strings Irish Lights actually
 * publishes, not against an idealised grammar. The real data is messier than the
 * textbook, and every allowance below exists because some station needs it:
 *
 *   Fl WR 5s                            the ordinary case
 *   ISO WR 4s                           form in caps (Buncrana, Donaghadee)
 *   Fl(2) WRG 10s.                      no space after the form (Inishowen)
 *   Fl (2)W 15s                         no space before the colour (Slyne Head)
 *   Fl R 5 s                            a space inside the period (Muglins)
 *   Fl (4) W 30 secs, Night time only   "secs", and trailing prose (Tory Island)
 *   Fl (2) 20s                          no colour named at all (Kish Bank)
 *   Dir Oc WRG 5s (24 hours)            directional, with a parenthetical
 *   Fl (2) W 20s. Auxiliary Light Fl R 3s over ...   two lights in one field
 *
 * Anything after the code is preserved as `note` rather than treated as an error,
 * because for a reader it is often the most interesting part of the line.
 */

import type { CharacterSpec, LightColour, LightForm } from './types';

/**
 * Forms, longest-first. Order is load-bearing: `LFL` must be tried before `FL`,
 * `VQ`/`UQ` before `Q`, and bare `F` last, or `Fl W 5s` parses as a fixed light.
 */
const FORM_PATTERN = 'LFL|FL|ISO|OC|VQ|UQ|MO|Q|F';

const FORMS: Record<string, LightForm> = {
  F: 'F',
  FL: 'Fl',
  LFL: 'LFl',
  OC: 'Oc',
  ISO: 'Iso',
  Q: 'Q',
  VQ: 'VQ',
  UQ: 'UQ',
  MO: 'Mo',
};

const COLOURS: Record<string, LightColour> = {
  W: 'white',
  R: 'red',
  G: 'green',
  Y: 'yellow',
};

/**
 * Matched against an upper-cased copy of the string. Upper-casing normalises
 * `Iso`/`ISO` and `Fl`/`FL` in one move; it is safe for slicing the note back out
 * of the original because these strings are ASCII, so lengths are unchanged.
 */
const CHARACTER_RE = new RegExp(
  [
    '^\\s*',
    '(?<dir>DIR\\b\\s*)?',
    // "Gp Fl (2)" is the older notation for a group flash and still appears in
    // some Irish Lights copy.
    '(?:GP\\s+)?',
    `(?<form>${FORM_PATTERN})`,
    '\\s*',
    // (3) for a group count, (A) for a Morse letter.
    '(?:\\(\\s*(?<group>\\d+|[A-Z])\\s*\\))?',
    '\\s*',
    '(?<colours>(?:[WRGY]\\s*)+)?',
    '\\s*',
    '(?:(?<period>\\d+(?:\\.\\d+)?)\\s*(?:SECONDS|SECOND|SECS|SEC|S)\\b)?',
  ].join(''),
);

/** Detects a second character embedded in the trailing prose. */
const AUXILIARY_RE = new RegExp(`(?:AUXILIARY|AUX)\\b[^.]*?\\b(?=${FORM_PATTERN})`, 'i');

function cleanNote(text: string): string | null {
  const trimmed = text.replace(/^[\s.,;:]+/, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseColours(raw: string | undefined): {
  colours: LightColour[];
  assumed: boolean;
} {
  const letters = (raw ?? '').replace(/\s+/g, '');
  if (letters.length === 0) {
    // IALA convention: an unqualified light is white. Four Irish stations rely
    // on this (`Fl (2) 20s`, `Fl (3) 15s`, `Fl (4) 30s`, `Fl (2) 20s`).
    return { colours: ['white'], assumed: true };
  }

  const colours: LightColour[] = [];
  for (const letter of letters) {
    const colour = COLOURS[letter];
    if (colour && !colours.includes(colour)) colours.push(colour);
  }
  return colours.length > 0 ? { colours, assumed: false } : { colours: ['white'], assumed: true };
}

function unparsedSpec(raw: string): CharacterSpec {
  return {
    raw,
    form: 'F',
    group: null,
    morseLetter: null,
    colours: ['white'],
    colourAssumed: true,
    periodMs: null,
    directional: false,
    note: cleanNote(raw),
    auxiliary: null,
    unparsed: true,
  };
}

/**
 * Parse a published light character.
 *
 * Never throws. An unrecognised string returns a spec with `unparsed: true` and the
 * whole input preserved as `note`, so one odd station degrades to "we cannot animate
 * this" rather than taking down the map.
 *
 * @param raw     the character string, exactly as published
 * @param allowAuxiliary internal: prevents runaway recursion on nested characters
 */
export function parseCharacter(raw: string, allowAuxiliary = true): CharacterSpec {
  if (!raw || raw.trim().length === 0) return unparsedSpec(raw ?? '');

  const upper = raw.toUpperCase();
  const match = CHARACTER_RE.exec(upper);
  const groups = match?.groups;

  if (!match || !groups?.['form']) return unparsedSpec(raw);

  const form = FORMS[groups['form']];
  if (!form) return unparsedSpec(raw);

  const groupToken = groups['group'];
  const isMorse = form === 'Mo';
  const numericGroup = groupToken !== undefined && /^\d+$/.test(groupToken);

  const { colours, assumed } = parseColours(groups['colours']);

  const periodToken = groups['period'];
  const periodMs = periodToken !== undefined ? Math.round(parseFloat(periodToken) * 1000) : null;

  // Slice the remainder from the ORIGINAL string so the note keeps its own casing.
  const note = cleanNote(raw.slice(match[0].length));

  let auxiliary: CharacterSpec | null = null;
  if (note && allowAuxiliary && AUXILIARY_RE.test(note)) {
    const auxMatch = AUXILIARY_RE.exec(note);
    if (auxMatch) {
      const candidate = parseCharacter(note.slice(auxMatch.index + auxMatch[0].length), false);
      if (!candidate.unparsed) auxiliary = candidate;
    }
  }

  return {
    raw,
    form,
    group: numericGroup ? Number(groupToken) : null,
    morseLetter: isMorse && groupToken !== undefined && !numericGroup ? groupToken : null,
    colours,
    colourAssumed: assumed,
    periodMs,
    directional: Boolean(groups['dir']),
    note,
    auxiliary,
    unparsed: false,
  };
}

/**
 * A short human label: "Group flashing (3), white and red, every 15 s".
 * Used in the station drawer next to the raw code.
 */
export function describeCharacter(spec: CharacterSpec): string {
  if (spec.unparsed) return 'Character not recognised';

  const FORM_NAMES: Record<LightForm, string> = {
    F: 'Fixed',
    Fl: 'Flashing',
    LFl: 'Long-flashing',
    Oc: 'Occulting',
    Iso: 'Isophase',
    Q: 'Quick-flashing',
    VQ: 'Very quick-flashing',
    UQ: 'Ultra quick-flashing',
    Mo: 'Morse',
  };

  const parts: string[] = [];
  if (spec.directional) parts.push('Directional');

  let name = FORM_NAMES[spec.form];
  if (spec.group !== null) name = `Group ${name.toLowerCase()} (${spec.group})`;
  if (spec.morseLetter) name = `Morse ‘${spec.morseLetter}’`;
  parts.push(parts.length > 0 ? name.toLowerCase() : name);

  const colourNames = spec.colours.join(spec.colours.length === 2 ? ' and ' : ', ');
  parts.push(spec.colourAssumed ? 'white' : colourNames);

  if (spec.periodMs !== null) parts.push(`every ${spec.periodMs / 1000} s`);

  return parts.join(', ');
}
