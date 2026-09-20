import { useEffect, useState } from 'react';

import { MapControls } from './components/MapControls';
import { MapView } from './components/MapView';
import { StationDrawer } from './components/StationDrawer';
import { StationList } from './components/StationList';
import { useDeepLink } from './lib/deepLink';
import { stations, stationsById } from './lib/stations';
import { useApp } from './state/store';

/**
 * Whether this device points with a finger. Drives both the copy ("tap" vs
 * "hover") and, in LightOverlay, the size of the hit target.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return coarse;
}

export function App() {
  const hoveredId = useApp((s) => s.hoveredId);
  const selectedId = useApp((s) => s.selectedId);
  const focus = stationsById.get(hoveredId ?? selectedId ?? '');
  const coarse = useCoarsePointer();

  useDeepLink();

  return (
    <div className="chart-surface relative h-full w-full overflow-hidden">
      <MapView />
      {/* First in the tab order: the map is a canvas, so this is the only way
          in for a keyboard or a screen reader. */}
      <StationList />
      <StationDrawer />

      {/*
        One flex column over the whole chart rather than absolutely positioned
        corners. At 375px the masthead and the controls were overlapping each
        other; in flow they cannot, at any width.
      */}
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:p-8">
          <header>
            <p className="chart-figure text-brass-dim uppercase">
              <span className="sm:hidden">Irish Lights</span>
              <span className="hidden sm:inline">Commissioners of Irish Lights</span>
            </p>
            <h1 className="mt-1 text-[1.75rem] leading-none text-paper sm:text-5xl">
              Great Irish Lighthouses
            </h1>
            <p className="mt-1.5 hidden max-w-sm text-sm text-paper-dim sm:block">
              {stations.length} lights, each blinking in its own published rhythm.
            </p>
          </header>

          <MapControls />
        </div>

        {/* Read-out. `mt-auto` pins it to the foot of the column. */}
        <div className="mt-auto p-4 pb-12 sm:p-8 sm:pb-10">
          {focus ? (
            <div className="max-w-sm">
              <h2 className="text-xl text-paper sm:text-2xl">{focus.name}</h2>
              <p className="chart-figure mt-1 text-brass">{focus.character.raw}</p>
              <p className="chart-figure mt-0.5 hidden text-paper-faint sm:block">
                {focus.position.raw}
              </p>
            </div>
          ) : (
            <p className="chart-figure max-w-[16rem] text-paper-faint">
              {coarse ? 'Tap a light to read it.' : 'Hover a light to read it.'} Not for navigation.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
