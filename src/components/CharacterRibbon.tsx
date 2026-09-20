/**
 * The character ribbon.
 *
 * One period of a light's rhythm drawn as bars, with a playhead sweeping across
 * in real time. It is the thing that makes a character *readable*: `Fl (3) W 15s`
 * is an abstraction, but three bright marks followed by a long gap is not.
 *
 * The bars are static — they come from the parsed timeline and never change, so
 * React renders them once. Only the playhead moves, and it is positioned by
 * writing a transform directly to the DOM from the shared clock. Putting the
 * playhead in React state would re-render the drawer sixty times a second.
 */

import { useEffect, useRef } from 'react';

import { progressAt } from '../lib/character/sample';
import { subscribe } from '../lib/clock';
import { LIGHT_COLOURS, type Station } from '../lib/stations';

interface Props {
  station: Station;
}

export function CharacterRibbon({ station }: Props) {
  const playhead = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return subscribe((t) => {
      const node = playhead.current;
      if (!node) return;
      const progress = progressAt(station.timeline, t, station.offsetMs);
      node.style.transform = `translateX(${progress * 100}%)`;
    });
  }, [station]);

  const { phases, periodMs } = station.timeline;
  const seconds = periodMs / 1000;
  const colour = LIGHT_COLOURS[station.primaryColour];

  return (
    <div>
      <div className="ribbon" style={{ ['--light-colour' as string]: colour }}>
        {phases.map((phase, i) => (
          <div
            key={i}
            className={`ribbon__phase ribbon__phase--${phase.lit ? 'lit' : 'dark'}`}
            style={{ width: `${(phase.ms / periodMs) * 100}%` }}
          />
        ))}
        {/* `left: 0` plus a translate keeps the playhead on the compositor. */}
        <div ref={playhead} className="ribbon__playhead" style={{ left: 0 }} />
      </div>

      <div className="ribbon__scale">
        <span>0s</span>
        <span>{(seconds / 2).toFixed(seconds % 2 === 0 ? 0 : 1)}s</span>
        <span>{seconds}s</span>
      </div>
    </div>
  );
}
