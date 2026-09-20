/**
 * The light itself.
 *
 * Two things make this more than a blinking bulb:
 *
 * 1. It reads `sampleAt` — the *same* function the map dot uses, at the same
 *    clock time and with the same per-station offset. The tower and the dot
 *    representing it therefore cannot disagree about whether the light is on.
 *
 * 2. Rotating lights are modelled as rotating. A flashing character comes from
 *    an optic with N panels turning once per period, which is why `Fl (3) W 15s`
 *    flashes three times in fifteen seconds. So we draw `group` beams spaced
 *    evenly around the axis and turn the whole assembly once per period — the
 *    flash then emerges from the geometry, as it does in the real tower.
 *
 *    Isophase, occulting and fixed lights do not sweep, so they get an
 *    omnidirectional glow that modulates instead.
 */

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { progressAt, sampleAt } from '../lib/character/sample';
import { now } from '../lib/clock';
import { LIGHT_COLOURS, type Station } from '../lib/stations';

interface Props {
  station: Station;
  focalHeight: number;
  radius: number;
}

export function Beam({ station, focalHeight, radius }: Props) {
  const assembly = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const beamRefs = useRef<THREE.Mesh[]>([]);

  const colour = LIGHT_COLOURS[station.primaryColour];
  // Shared with the map's sweep via `lib/stations`, so the tower and the dot
  // representing it can never disagree about what kind of light this is.
  const { rotating, panels } = station;

  // Scale the beam to the tower, not to the lantern's radius, and keep it
  // shorter than the framed view. Deriving length from radius gave Maidens a
  // 64-unit beam on a 2.3-unit tower; even at 4.5x the focal height the beams
  // overran the frame and read as grey wedges rather than light. The tower is
  // the subject — the beam is there to show its rhythm, not to dominate.
  const beamLength = Math.max(2.5, focalHeight * 2.2);
  const beamWidth = Math.max(radius * 1.1, focalHeight * 0.075);

  /**
   * A gradient down the beam: bright at the lamp, gone at the far end.
   *
   * Without it the shaft is a flat wedge that stops at a hard edge, which is
   * the single most artificial thing about a naive volumetric beam — light
   * does not end, it fades.
   *
   * Done as an alphaMap on the cone's V axis rather than vertex colours: on an
   * additively blended MeshBasicMaterial, per-vertex alpha blew the whole
   * canvas out to white.
   */
  const falloff = useMemo(() => {
    const steps = 64;
    const data = new Uint8Array(steps * 4);
    for (let i = 0; i < steps; i += 1) {
      // ConeGeometry's V runs 0 at the apex (the lamp) to 1 at the base.
      const t = i / (steps - 1);
      const alpha = Math.pow(1 - t, 1.8);
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = Math.round(alpha * 255);
    }
    const texture = new THREE.DataTexture(data, 1, steps, THREE.RGBAFormat);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }, []);

  useEffect(() => () => falloff.dispose(), [falloff]);

  const beamMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        // Deliberately tone-mapped, unlike the lamp core: an additive surface
        // with tone mapping off accumulates unclamped where beams overlap.
        toneMapped: true,
        // Fades the shaft along its length — see `falloff` below.
        alphaMap: falloff,
      }),
    [colour, falloff],
  );

  const baseColour = useMemo(() => new THREE.Color(colour), [colour]);

  const coreMaterial = useMemo(
    // `toneMapped: false` keeps the lamp from being pulled back down by ACES —
    // it is a light source, not a lit surface.
    () => new THREE.MeshBasicMaterial({ color: colour, transparent: true, toneMapped: false }),
    [colour],
  );

  useFrame(() => {
    // Time comes from the application clock, never from r3f's own elapsed time,
    // so the beam stays locked to the map overlay and the character ribbon.
    const t = now();
    const { intensity } = sampleAt(station.timeline, t, station.offsetMs);

    if (core.current) {
      const material = core.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.35 + 0.65 * intensity;
      const scale = 0.85 + 0.35 * intensity;
      core.current.scale.setScalar(scale);
      // Drive the lamp above 1.0 so the bloom threshold catches it and the
      // light actually bleeds, rather than being a bright dot.
      material.color.copy(baseColour).multiplyScalar(0.7 + 1.9 * intensity);
    }

    if (glow.current) {
      glow.current.intensity = 0.4 + 5.5 * intensity;
    }

    if (rotating && assembly.current) {
      // One full revolution per period: N panels then give N flashes.
      //
      // Wrapped into a single revolution, like the map's sweep. Three.js keeps
      // this in float64 so the raw `t / period * 2π` happened to work here even
      // at billions of radians — but the same expression froze the map's
      // canvas beams solid, and one of the two silently disagreeing is exactly
      // what the shared clock exists to prevent.
      assembly.current.rotation.y = progressAt(station.timeline, t, station.offsetMs) * Math.PI * 2;
    } else {
      // Non-rotating characters modulate the beam's brightness instead.
      for (const beam of beamRefs.current) {
        if (!beam) continue;
        (beam.material as THREE.MeshBasicMaterial).opacity = 0.03 + 0.14 * intensity;
      }
    }
  });

  return (
    <group position={[0, focalHeight, 0]}>
      {/* The lamp seen directly. */}
      <mesh ref={core}>
        <sphereGeometry args={[radius * 0.55, 16, 16]} />
        <primitive object={coreMaterial} attach="material" />
      </mesh>

      <pointLight ref={glow} color={colour} distance={beamLength * 0.6} decay={1.6} />

      <group ref={assembly}>
        {rotating
          ? Array.from({ length: panels }, (_, i) => {
              const angle = (i / panels) * Math.PI * 2;
              return (
                // Each panel gets its own group rotated about Y, so the cone
                // inside only needs one fixed rotation. Composing both on a
                // single mesh means reasoning about Euler order, which is how
                // the first attempt ended up pointing the beams at the sky.
                <group key={i} rotation={[0, angle, 0]}>
                  <mesh
                    ref={(node) => {
                      if (node) beamRefs.current[i] = node;
                    }}
                    position={[beamLength / 2, 0, 0]}
                    // +Z maps the cone's apex toward the lamp and its base
                    // outward, so the beam widens with distance as a real one does.
                    rotation={[0, 0, Math.PI / 2]}
                    material={beamMaterial}
                  >
                    <coneGeometry args={[beamWidth, beamLength, 20, 1, true]} />
                  </mesh>
                </group>
              );
            })
          : /* Omnidirectional halo for isophase, occulting and fixed lights.
               Kept tight: at 4.5x the lantern radius this was a grey sphere
               that swallowed the whole tower top and read as fog rather than
               light. The spread should come from the bloom pass, not from
               geometry large enough to fill the frame. */
            [0].map((i) => (
              <mesh
                key={i}
                ref={(node) => {
                  if (node) beamRefs.current[i] = node;
                }}
                material={beamMaterial}
              >
                <sphereGeometry args={[radius * 1.5, 16, 16]} />
              </mesh>
            ))}
      </group>
    </group>
  );
}
