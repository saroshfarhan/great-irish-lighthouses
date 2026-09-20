/**
 * Application state.
 *
 * Deliberately small. Anything that changes every frame — the clock, each light's
 * intensity — is NOT in here: pushing 60 updates a second through a React store
 * would re-render the tree continuously. Frame-rate values live in the clock and
 * are read directly by the canvas overlay and the 3D scene, which draw
 * imperatively. This store holds only what a human changes.
 */

import { create } from 'zustand';

import type { LightColour } from '../lib/character/types';

export type Coast = 'north' | 'east' | 'south' | 'west';

export const ALL_COASTS: Coast[] = ['north', 'east', 'south', 'west'];
export const ALL_COLOURS: LightColour[] = ['white', 'red', 'green', 'yellow'];

interface AppState {
  /** The station whose drawer is open, or null. */
  selectedId: string | null;
  /** The station under the pointer, for the map's hover label. */
  hoveredId: string | null;

  /** Clock speed multiplier. */
  rate: number;

  /**
   * The viewer's OS-level motion preference, read once at start-up.
   *
   * Blinking is not decoration here — it is the content — so we do not simply
   * switch it off. Lights are held at a steady glow and the viewer is offered a
   * control to start them, which respects the preference without silently
   * removing the reason the map exists.
   */
  reduceMotion: boolean;
  /** Set when the viewer asks for the rhythms despite the preference above. */
  motionOverride: boolean;

  coasts: Set<Coast>;
  colours: Set<LightColour>;

  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setRate: (rate: number) => void;
  setMotionOverride: (on: boolean) => void;
  toggleCoast: (coast: Coast) => void;
  toggleColour: (colour: LightColour) => void;
  resetFilters: () => void;
}

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  // Never let the map go completely empty — an all-off filter reads as a bug.
  return next.size === 0 ? set : next;
}

export const useApp = create<AppState>((set) => ({
  selectedId: null,
  hoveredId: null,
  rate: 1,
  reduceMotion:
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  motionOverride: false,
  coasts: new Set(ALL_COASTS),
  colours: new Set(ALL_COLOURS),

  select: (id) => set({ selectedId: id }),
  hover: (id) => set({ hoveredId: id }),
  setRate: (rate) => set({ rate }),
  setMotionOverride: (motionOverride) => set({ motionOverride }),
  toggleCoast: (coast) => set((s) => ({ coasts: toggle(s.coasts, coast) })),
  toggleColour: (colour) => set((s) => ({ colours: toggle(s.colours, colour) })),
  resetFilters: () => set({ coasts: new Set(ALL_COASTS), colours: new Set(ALL_COLOURS) }),
}));
