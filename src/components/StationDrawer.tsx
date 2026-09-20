/**
 * The station drawer.
 *
 * A bottom sheet on a phone, a side panel from `sm:` up — built that way from
 * the start rather than retrofitted, because a side panel at 375px is unusable.
 *
 * The 3D scene is `lazy`, so Three.js is fetched on the first station opened and
 * never before. The canvas unmounts with the drawer: no idle WebGL context.
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useEffect, useState } from 'react';

import { describeCharacter } from '../lib/character/parse';
import type { Station } from '../lib/stations';
import { stationsById } from '../lib/stations';
import { useApp } from '../state/store';
import { CharacterRibbon } from './CharacterRibbon';
import { StationPhotos } from './StationPhotos';

const Scene = lazy(() => import('../three/Scene'));

/** Histories are a separate 350 KiB file, fetched only when one is read. */
let historyCache: Record<string, string> | null = null;

function useHistory(station: Station | undefined): string | null {
  const [history, setHistory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    if (!station?.has_history) return undefined;

    const load = async () => {
      historyCache ??= (await import('../data/histories.json')).default as Record<string, string>;
      if (!cancelled) setHistory(historyCache[station.id] ?? null);
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [station]);

  return history;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="border-b border-graticule py-2">
      <dt className="chart-figure text-paper-faint uppercase">{label}</dt>
      <dd className="chart-figure mt-1 text-paper">{value}</dd>
    </div>
  );
}

function Body({ station }: { station: Station }) {
  const history = useHistory(station);
  const isGeneric = (station.tower.evidence ?? 'default') !== 'photo';

  const ranges = station.ranges
    ?.map((r) => `${r.colour ?? 'all'} ${r.nautical_miles} nm`)
    .join(' · ');

  const sectors = station.sectors?.filter((a) => a.kind === 'sector') ?? [];
  const visibility = station.sectors?.filter((a) => a.kind === 'visibility') ?? [];
  const obscured = station.sectors?.filter((a) => a.kind === 'obscured') ?? [];

  return (
    <div className="flex h-full flex-col overflow-y-auto overscroll-contain">
      <div className="px-5 pt-4 sm:px-6">
        <h2 className="text-2xl text-paper sm:text-3xl">{station.name}</h2>
        <p className="chart-figure mt-1 text-brass">{station.character.raw}</p>
        <p className="mt-1 text-sm text-paper-dim">{describeCharacter(station.spec)}</p>
      </div>

      {/* The rhythm, drawn. */}
      <div className="px-5 pt-4 sm:px-6">
        <CharacterRibbon station={station} />
      </div>

      {/* The tower. */}
      {/* The tower deserves the room: it is the reason the drawer exists. */}
      <div className="relative mt-4 h-64 shrink-0 bg-ink-950 sm:h-[22rem]">
        <Suspense
          fallback={
            <div className="chart-figure flex h-full items-center justify-center text-paper-faint">
              building tower…
            </div>
          }
        >
          <Scene station={station} />
        </Suspense>
      </div>

      {isGeneric ? (
        <p className="chart-caveat mx-5 mt-4 sm:mx-6">
          <strong>Generic tower.</strong> No clear photograph of this lighthouse is available, so
          this is a stand-in rather than a likeness. Its position, light character and timing are
          accurate.
        </p>
      ) : null}

      <dl className="mt-4 px-5 pb-6 sm:px-6">
        <Field label="Position" value={station.position.raw} />
        <Field label="Range" value={ranges} />
        <Field
          label="Tower height"
          value={station.tower_height_m ? `${station.tower_height_m} m` : null}
        />
        <Field
          label="Light above MHWS"
          value={station.light_height_m ? `${station.light_height_m} m` : null}
        />
        <Field label="Radar beacon" value={station.radar_beacon} />
        <Field label="AIS" value={station.ais} />

        {sectors.length > 0 ? (
          <Field
            label={`Sectors (${sectors.length})`}
            value={
              <span className="block space-y-0.5">
                {sectors.map((a, i) => (
                  <span key={i} className={`block light-${a.colour ?? 'white'}`}>
                    {a.colour} {a.from_shore ? 'shore' : `${a.from_deg}°`}–
                    {a.to_shore ? 'shore' : `${a.to_deg}°`}
                    {a.width_deg ? ` (${a.width_deg}°)` : ''}
                  </span>
                ))}
              </span>
            }
          />
        ) : null}

        {visibility.length > 0 ? (
          <Field
            label="Visible over"
            value={visibility
              .map((a) => `${a.from_deg}°–${a.to_deg}°${a.width_deg ? ` (${a.width_deg}°)` : ''}`)
              .join(', ')}
          />
        ) : null}

        {obscured.length > 0 ? (
          <Field
            label="Obscured"
            value={obscured.map((a) => `${a.from_deg}°–${a.to_deg}°`).join(', ')}
          />
        ) : null}

        {station.spec.auxiliary ? (
          <Field label="Auxiliary light" value={station.spec.auxiliary.raw} />
        ) : null}
      </dl>

      <StationPhotos photos={station.photos ?? []} name={station.name} />

      {history ? (
        <div className="border-t border-graticule px-5 py-5 sm:px-6">
          <h3 className="chart-figure text-paper-faint uppercase">History</h3>
          <p className="mt-2 text-sm leading-relaxed text-paper-dim">{history}</p>
        </div>
      ) : null}

      <div className="px-5 pb-8 sm:px-6">
        <a
          className="chart-figure text-brass-dim underline underline-offset-4 hover:text-brass"
          href={station.source_url}
          target="_blank"
          rel="noreferrer"
        >
          Source: Irish Lights ↗
        </a>
      </div>
    </div>
  );
}

/** The drawer slides up from the foot on a phone and in from the edge on desktop. */
function useWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(min-width: 640px)');
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

export function StationDrawer() {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const station = stationsById.get(selectedId ?? '');
  const reduced = useReducedMotion();
  const wide = useWide();

  const hidden = wide ? { opacity: 0, x: '100%', y: 0 } : { opacity: 0, y: '100%', x: 0 };
  const shown = { opacity: 1, x: 0, y: 0 };

  // Escape closes, as it should for anything panel-shaped.
  useEffect(() => {
    if (!selectedId) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, select]);

  return (
    <AnimatePresence>
      {station ? (
        <motion.aside
          key={station.id}
          className="chart-panel station-drawer"
          initial={reduced ? { opacity: 0 } : hidden}
          animate={reduced ? { opacity: 1 } : shown}
          exit={reduced ? { opacity: 0 } : hidden}
          transition={{ duration: reduced ? 0.15 : 0.42, ease: [0.22, 0.61, 0.36, 1] }}
          aria-label={`${station.name} lighthouse details`}
        >
          {/* Grab handle: signals the sheet, and is the close target on touch. */}
          <button
            type="button"
            onClick={() => select(null)}
            aria-label="Close"
            className="absolute top-0 right-0 left-0 z-10 flex h-8 items-center justify-center sm:h-10 sm:justify-end sm:px-4"
          >
            <span className="h-1 w-10 rounded-full bg-paper-faint/50 sm:hidden" />
            <span className="chart-figure hidden text-paper-faint hover:text-paper sm:inline">
              ESC ✕
            </span>
          </button>

          <div className="h-full pt-8 sm:pt-10">
            <Body station={station} />
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
