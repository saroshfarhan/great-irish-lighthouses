/**
 * The keyboard and screen-reader route to every station.
 *
 * The map is a `<canvas>`, so without this the app's entire content — 65
 * lighthouses — is unreachable by anything that is not a pointer. No amount of
 * ARIA on a canvas fixes that; the only honest solution is real focusable
 * elements carrying the same information.
 *
 * It is visually hidden but *not* `display: none`, so it stays in the tab order
 * and in the accessibility tree. Focusing an entry highlights that light on the
 * map exactly as hovering does, and the first Tab reveals a visible panel so a
 * sighted keyboard user can see where they are rather than chasing an invisible
 * focus ring.
 */

import { useState } from 'react';

import { describeCharacter } from '../lib/character/parse';
import { stations } from '../lib/stations';
import { useApp } from '../state/store';

export function StationList() {
  const hover = useApp((s) => s.hover);
  const select = useApp((s) => s.select);
  const selectedId = useApp((s) => s.selectedId);
  const coasts = useApp((s) => s.coasts);
  const colours = useApp((s) => s.colours);

  /** Revealed once focus enters, so keyboard users can see the list they are in. */
  const [visible, setVisible] = useState(false);

  // Mirror the map's filters, so the two views never disagree about what exists.
  const shown = stations.filter(
    (s) =>
      coasts.has(s.coast as never) && s.allColours.some((c) => colours.has(c)),
  );

  return (
    <nav
      aria-label="All lighthouses"
      className={
        visible
          ? 'chart-panel absolute top-0 bottom-0 left-0 z-40 w-80 overflow-y-auto p-4'
          : 'sr-only'
      }
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setVisible(false);
          hover(null);
        }
      }}
    >
      <h2 className="chart-figure text-paper-faint uppercase">
        {shown.length} lighthouses — use arrow keys or Tab
      </h2>

      <ul className="mt-2">
        {shown.map((station) => (
          <li key={station.id}>
            <button
              type="button"
              onFocus={() => hover(station.id)}
              onMouseEnter={() => hover(station.id)}
              onClick={() => select(station.id)}
              aria-current={station.id === selectedId ? 'true' : undefined}
              className="w-full rounded-sm px-2 py-2 text-left hover:bg-ink-700/60 focus:bg-ink-700/60"
            >
              <span className="block text-paper">{station.name}</span>
              <span className="chart-figure block text-paper-dim">
                {station.character.raw}
              </span>
              {/* Spoken, not shown: the code alone is opaque read aloud. */}
              <span className="sr-only">
                {describeCharacter(station.spec)}. {station.coast} coast.
                Position {station.position.raw}.
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
