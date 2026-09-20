/**
 * The flight from chart to tower.
 *
 * Clicking a light should feel like descending to it, not like opening a modal.
 * That means the map camera and the drawer have to move as one gesture.
 *
 * A single Motion value `t: 0 -> 1` drives everything. The map camera is
 * interpolated from that value and written with `jumpTo`, rather than handing
 * the move to MapLibre's own `easeTo` queue — because a second animator would
 * have its own easing and its own idea of when it finished, and the drawer
 * would arrive out of step with the camera. Same discipline as the light clock:
 * one source of truth, several consumers.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import { animate } from 'motion';

export interface CameraState {
  lon: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

/** How close the flight settles, and how far it tips the horizon over. */
export const STATION_ZOOM = 12.5;
export const STATION_PITCH = 62;

/** Matches --duration-flight and --ease-chart in theme.css. */
export const FLIGHT_MS = 1100;
const EASE_CHART: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

export function readCamera(map: MapLibreMap): CameraState {
  const centre = map.getCenter();
  return {
    lon: centre.lng,
    lat: centre.lat,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpCamera(from: CameraState, to: CameraState, t: number): CameraState {
  return {
    lon: lerp(from.lon, to.lon, t),
    lat: lerp(from.lat, to.lat, t),
    zoom: lerp(from.zoom, to.zoom, t),
    pitch: lerp(from.pitch, to.pitch, t),
    bearing: lerp(from.bearing, to.bearing, t),
  };
}

export interface FlightOptions {
  onProgress?: (t: number) => void;
  onComplete?: () => void;
  reducedMotion?: boolean;
}

/**
 * Fly the map camera to `to`. Returns a stop function.
 *
 * With `reducedMotion` the camera is placed immediately and the caller
 * cross-fades instead — the plan's commitment that reduced motion collapses the
 * flight rather than merely shortening it.
 */
export function flyCamera(
  map: MapLibreMap,
  to: CameraState,
  { onProgress, onComplete, reducedMotion = false }: FlightOptions = {},
): () => void {
  const from = readCamera(map);

  const apply = (t: number) => {
    const camera = lerpCamera(from, to, t);
    map.jumpTo({
      center: [camera.lon, camera.lat],
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
    });
    onProgress?.(t);
  };

  if (reducedMotion) {
    apply(1);
    onComplete?.();
    return () => {};
  }

  const controls = animate(0, 1, {
    duration: FLIGHT_MS / 1000,
    ease: EASE_CHART,
    onUpdate: apply,
    onComplete: () => onComplete?.(),
  });

  return () => controls.stop();
}

/** The camera that frames a station for the descent. */
export function cameraForStation(lon: number, lat: number, bearing: number): CameraState {
  return { lon, lat, zoom: STATION_ZOOM, pitch: STATION_PITCH, bearing };
}
