/**
 * Legend and colour filter in one panel.
 *
 * A sea chart has a legend; this one doubles as the control, so reading what a
 * colour means and isolating it are the same gesture. Collapsed by default —
 * the map should be the first thing you see, not its documentation.
 */

import { useState } from 'react';

import type { LightColour } from '../lib/character/types';
import { LIGHT_COLOURS, stations } from '../lib/stations';
import { ALL_COLOURS, useApp } from '../state/store';

const MEANING: Record<LightColour, string> = {
  white: 'Main light / safe water',
  red: 'Port side or danger sector',
  green: 'Starboard side sector',
  yellow: 'Special mark',
};

export function Legend() {
  const [open, setOpen] = useState(false);
  const colours = useApp((s) => s.colours);
  const toggleColour = useApp((s) => s.toggleColour);

  // Count every colour a light shows, matching what the filter acts on. Counting
  // only the primary colour reported "green 0" while several stations have
  // green sectors, which is worse than no count at all.
  const counts = new Map<LightColour, number>();
  for (const station of stations) {
    for (const colour of station.allColours) {
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
  }

  return (
    <div className="pointer-events-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="chart-figure flex min-h-11 items-center rounded-sm border border-edge bg-ink-900/70 px-3 text-paper-faint uppercase transition-colors hover:text-paper-dim sm:min-h-8"
      >
        Legend {open ? '−' : '+'}
      </button>

      {open ? (
        <div className="chart-panel mt-2 w-60 rounded-sm p-3">
          <p className="chart-figure text-paper-faint uppercase">Light colour</p>

          <ul className="mt-2 space-y-1">
            {ALL_COLOURS.map((colour) => {
              const count = counts.get(colour) ?? 0;
              const active = colours.has(colour);
              return (
                <li key={colour}>
                  <button
                    type="button"
                    onClick={() => toggleColour(colour)}
                    disabled={count === 0}
                    aria-pressed={active}
                    className={[
                      'flex min-h-11 w-full items-center gap-2 rounded-sm px-1 py-1 text-left transition-opacity sm:min-h-0',
                      active ? 'opacity-100' : 'opacity-35',
                      count === 0 ? 'cursor-default opacity-20' : 'hover:bg-ink-700/60',
                    ].join(' ')}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        background: LIGHT_COLOURS[colour],
                        boxShadow: `0 0 8px ${LIGHT_COLOURS[colour]}`,
                      }}
                    />
                    <span className="chart-figure text-paper capitalize">{colour}</span>
                    <span className="chart-figure ml-auto text-paper-faint">{count}</span>
                  </button>
                  <p className="chart-figure pl-[1.375rem] text-paper-faint">{MEANING[colour]}</p>
                </li>
              );
            })}
          </ul>

          <p className="chart-figure mt-4 text-paper-faint uppercase">Sweeping beams</p>
          <p className="chart-caveat mt-1">
            Lights with a <strong>rotating optic</strong> sweep; their beam count is the
            number of panels, so <span className="text-brass">Fl (3)</span> throws three.
            Isophase, occulting and fixed lights do not turn, and only pulse. Beam length is
            each light&rsquo;s published range &mdash; lengthened at low zoom so ranges stay
            comparable, true to scale as you zoom in.
          </p>

          <p className="chart-caveat mt-3">
            Sectored lights show different colours on different bearings. The map draws the
            first published colour; the full sector list is in each station&rsquo;s panel.
          </p>
        </div>
      ) : null}
    </div>
  );
}
