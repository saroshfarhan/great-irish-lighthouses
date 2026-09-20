/**
 * Flies the map camera when a station is selected, and returns it when closed.
 *
 * Renders nothing. It exists so the flight is owned in one place rather than
 * scattered between the overlay's click handler and the drawer's mount effect.
 *
 * The drawer covers part of the chart — the lower two-thirds on a phone, the
 * right quarter on a desktop — so the camera is offset to keep the station in
 * the part of the map that is still visible. Flying a light to the centre of
 * the viewport and then covering it with a panel is the obvious bug here.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { cameraForStation, flyCamera, readCamera, type CameraState } from '../lib/flight';
import { stationsById } from '../lib/stations';
import { useApp } from '../state/store';

interface Props {
  map: MapLibreMap;
}

export function StationFlight({ map }: Props) {
  const selectedId = useApp((s) => s.selectedId);

  /** Where the chart was before the first descent, so Escape can restore it. */
  const homeRef = useRef<CameraState | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const narrow = map.getContainer().clientWidth < 640;

    stopRef.current?.();

    if (!selectedId) {
      // Returning home: only if we actually left, and only to where we were.
      const home = homeRef.current;
      homeRef.current = null;
      if (home) {
        stopRef.current = flyCamera(map, home, { reducedMotion: reduced });
      }
      return undefined;
    }

    const station = stationsById.get(selectedId);
    if (!station) return undefined;

    homeRef.current ??= readCamera(map);

    const target = cameraForStation(
      station.position.lon,
      station.position.lat,
      map.getBearing(),
    );

    stopRef.current = flyCamera(map, target, {
      reducedMotion: reduced,
      onComplete: () => {
        // Shift the station out from under the drawer once the descent lands.
        // Done with padding rather than a fudged centre so MapLibre keeps the
        // true geographic target — panning by a guessed offset drifts with zoom.
        map.easeTo({
          padding: narrow
            ? { top: 0, bottom: Math.round(map.getContainer().clientHeight * 0.55), left: 0, right: 0 }
            : { top: 0, bottom: 0, left: 0, right: 384 },
          duration: 420,
        });
      },
    });

    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [selectedId, map]);

  // Clear the drawer padding when nothing is selected, so the chart re-centres.
  useEffect(() => {
    if (selectedId) return;
    map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 });
  }, [selectedId, map]);

  // Nothing to render; the whole job is camera side-effects.
  return null;
}
