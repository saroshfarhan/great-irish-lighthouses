/**
 * Solar position — is it dark at this place and time?
 *
 * CURRENTLY UNUSED, and kept deliberately.
 *
 * The map once lit a station only when its own sun was below the horizon, with
 * a scrubber to sweep the terminator across Ireland. Both were removed: the
 * app is about the rhythms, and someone opening it at midday should see them
 * rather than a dark coast. It was also simply too many controls for what this
 * is meant to be.
 *
 * This file survives because the maths is correct, tested against the real
 * coordinates, and cheap to keep — if a "what does the coast look like at 3am"
 * view is ever wanted, it is already here. Delete it freely if that never comes.
 *
 * A compact solar-position calculation, accurate to well under a degree.
 * Adapted from the standard NOAA approach.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
/** Julian date of the Unix epoch. */
const J1970 = 2_440_588;
const J2000 = 2_451_545;

function toJulian(date: number): number {
  return date / DAY_MS - 0.5 + J1970;
}

/** Days since J2000. */
function toDays(date: number): number {
  return toJulian(date) - J2000;
}

const OBLIQUITY = 23.4397 * RAD;

function solarMeanAnomaly(d: number): number {
  return RAD * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M: number): number {
  // Equation of centre plus the perihelion of Earth's orbit.
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372;
  return M + C + P + Math.PI;
}

function declination(l: number): number {
  return Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
}

function rightAscension(l: number): number {
  return Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l));
}

function siderealTime(d: number, lw: number): number {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

/**
 * The sun's altitude above the horizon, in degrees.
 * Negative means below the horizon.
 */
export function solarAltitude(date: number, lat: number, lon: number): number {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);

  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const ra = rightAscension(L);
  const H = siderealTime(d, lw) - ra;

  const altitude = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H),
  );
  return altitude / RAD;
}

/**
 * Civil twilight: the sun 6° below the horizon. Lighthouses are lit around
 * sunset rather than at the instant of it, so this is the more honest threshold
 * than altitude < 0.
 */
const LIT_THRESHOLD_DEG = -6;

export function isDark(date: number, lat: number, lon: number): boolean {
  return solarAltitude(date, lat, lon) < LIT_THRESHOLD_DEG;
}

/**
 * How "night" it is, 0–1, ramped across twilight so the coast fades up rather
 * than snapping on at a threshold. 0 is full day, 1 is fully dark.
 */
export function darkness(date: number, lat: number, lon: number): number {
  const altitude = solarAltitude(date, lat, lon);
  // Ramp between +2° (sun just up, lights off) and -8° (properly dark).
  const t = (2 - altitude) / 10;
  return Math.min(1, Math.max(0, t));
}
