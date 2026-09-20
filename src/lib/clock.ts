/**
 * The application's single clock.
 *
 * Rule 3 in CLAUDE.md: there is exactly one `requestAnimationFrame` loop in this
 * app. The map overlay, the character ribbon and the 3D beam all subscribe here.
 * Two loops would mean two answers to "what time is it", and the beam would drift
 * out of step with the dot representing the same light.
 *
 * Time is accumulated rather than read fresh each frame, so changing the rate
 * mid-flight speeds the world up smoothly instead of jumping.
 *
 * The loop stops completely when nothing is subscribed and while the tab is
 * hidden — a background tab should cost nothing.
 */

export type ClockListener = (tMs: number) => void;

/** Seeded from the wall clock so that at rate 1 the app runs on real time. */
let virtualMs = Date.now();
let rate = 1;
let lastFrame: number | null = null;
let rafId: number | null = null;
let paused = false;

const listeners = new Set<ClockListener>();

function frame(now: number): void {
  rafId = requestAnimationFrame(frame);

  const delta = lastFrame === null ? 0 : now - lastFrame;
  lastFrame = now;

  // Guard against the enormous delta produced when a tab is restored or the
  // machine wakes; without it every light would jump to an arbitrary phase.
  const clamped = Math.min(delta, 100);
  virtualMs += clamped * rate;

  for (const listener of listeners) listener(virtualMs);
}

function start(): void {
  if (rafId !== null || paused || listeners.size === 0) return;
  lastFrame = null;
  rafId = requestAnimationFrame(frame);
}

function stop(): void {
  if (rafId === null) return;
  cancelAnimationFrame(rafId);
  rafId = null;
  lastFrame = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    if (paused) stop();
    else start();
  });
}

/** Subscribe to every frame. Returns an unsubscribe function. */
export function subscribe(listener: ClockListener): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** Current virtual time in milliseconds. */
export function now(): number {
  return virtualMs;
}

/**
 * Speed multiplier. 1 is real time; 60 runs a minute per second, which is how you
 * watch the whole coast pulse in its different rhythms at once.
 */
export function setRate(next: number): void {
  rate = next;
}

export function getRate(): number {
  return rate;
}

/**
 * Jump the clock to an arbitrary instant.
 *
 * Unused since the time-of-day scrubber was removed, but kept: it is two lines,
 * it completes the clock's API, and `sampleAt` already tolerates the negative
 * and discontinuous times it can produce.
 */
export function setTime(ms: number): void {
  virtualMs = ms;
}

/** Return to real time at normal speed. */
export function resetToNow(): void {
  virtualMs = Date.now();
  rate = 1;
}
