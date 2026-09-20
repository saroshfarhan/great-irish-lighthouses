/**
 * The 3D view inside the station drawer.
 *
 * Lazy-loaded: nothing here — including Three.js — is fetched until the first
 * station is opened, keeping ~248 KiB gzip off the map's first paint.
 *
 * WHY THIS LOOKS THE WAY IT DOES
 *
 * A first pass rendered as flat grey primitives. Four things fixed that, and
 * they matter more than any amount of extra geometry:
 *
 *  1. An **environment map**. `MeshStandardMaterial` is physically based: with
 *     nothing to reflect it can only look like plastic. The environment here is
 *     built from `Lightformer` panels rather than a downloaded HDRI, so it costs
 *     no network request and can be coloured to match the Night Chart palette.
 *  2. **ACES tone mapping** with a lifted exposure. Raw linear output crushed
 *     every dark value together, which is why each tower read as one black
 *     shape regardless of its actual paint scheme.
 *  3. **Reflections in the water.** A lighthouse stands in the sea; a flat matte
 *     disc reads as grey card. The reflection is what sells the setting.
 *  4. **Bloom on the lamp.** A light source that does not bleed does not look
 *     like a light source.
 *
 * PERFORMANCE. This revisits the earlier "no post-processing" rule deliberately.
 * That rule was written for a full-screen canvas; this one is ~384×288 inside a
 * drawer and only exists while a station is open. Bloom at that size is cheap,
 * and the frame budget is re-measured after every change to this file.
 *
 * Rule 3 still holds: r3f's own loop is off (`frameloop="demand"`) and the
 * shared clock invalidates it.
 */

import {
  ContactShadows,
  Environment,
  Lightformer,
  MeshReflectorMaterial,
  OrbitControls,
  Stars,
} from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { subscribe } from '../lib/clock';
import type { Station } from '../lib/stations';
import { METRES } from './buildProfile';
import { GenericTower, genericFootprintRadius, genericTowerAxis } from './GenericTower';
import { seaNormalMap } from './textures';
import { Tower } from './Tower';

/** Drives the demand-based canvas from the application clock. */
function Ticker() {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => subscribe(() => invalidate()), [invalidate]);
  return null;
}

/**
 * A blue-hour sky: deep navy overhead falling to a cold horizon glow.
 *
 * Painted on the inside of a sphere with a two-stop gradient. Cheaper than any
 * atmosphere model, and it gives the tower something to be silhouetted against
 * so the scene has depth rather than sitting on flat black.
 */
function SkyDome({ radius }: { radius: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color('#04070d') },
          // Muted deliberately: a saturated horizon reads as a bright blue
          // stripe across the top of the panel and pulls the eye off the tower.
          horizon: { value: new THREE.Color('#132132') },
          bottom: { value: new THREE.Color('#03060a') },
        },
        vertexShader: /* glsl */ `
          varying float vH;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vH = normalize(world.xyz).y;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
          varying float vH;
          void main() {
            float h = vH;
            vec3 c = h > 0.0
              ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55))
              : mix(horizon, bottom, pow(clamp(-h, 0.0, 1.0), 0.4));
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    [],
  );

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh material={material}>
      <sphereGeometry args={[radius, 32, 16]} />
    </mesh>
  );
}

/** Sea surface. The reflection and the ripple are doing most of the work here. */
function Sea({ radius, scale }: { radius: number; scale: number }) {
  const normalMap = useMemo(() => seaNormalMap(), []);
  useEffect(() => () => normalMap.dispose(), [normalMap]);

  // Tile the swell relative to the tower so a 6 m light and a 54 m one both sit
  // in water of a believable scale.
  normalMap.repeat.set(radius / (scale * 3), radius / (scale * 3));

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <circleGeometry args={[radius, 64]} />
      <MeshReflectorMaterial
        // Small buffer on purpose: the canvas is ~384px wide, so a larger
        // reflection map would cost frames for detail nobody can resolve.
        resolution={256}
        blur={[400, 120]}
        mixBlur={0.9}
        mixStrength={2.6}
        depthScale={0.7}
        minDepthThreshold={0.3}
        maxDepthThreshold={1.2}
        color="#070e18"
        roughness={0.62}
        metalness={0.6}
        mirror={0}
        normalMap={normalMap}
        normalScale={new THREE.Vector2(0.28, 0.28)}
      />
    </mesh>
  );
}

/**
 * The moon. Small, but it explains where the key light comes from — without it
 * the scene is lit from nowhere, which the eye notices even if it cannot say why.
 */
function Moon({ distance, scale }: { distance: number; scale: number }) {
  return (
    <group position={[-distance * 1.3, distance * 0.95, -distance * 1.5]}>
      <mesh>
        <sphereGeometry args={[scale * 0.5, 24, 24]} />
        <meshBasicMaterial color="#e8f0fb" toneMapped={false} />
      </mesh>
      {/* A soft halo, picked up by the bloom pass. */}
      <mesh>
        <sphereGeometry args={[scale * 0.9, 20, 20]} />
        <meshBasicMaterial color="#9fb8d8" transparent opacity={0.18} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * The environment. Lightformers are emissive panels rendered into a cubemap —
 * studio lighting without an HDRI file, and tinted to the app's palette.
 */
function NightEnvironment({ scale }: { scale: number }) {
  return (
    <Environment resolution={128} frames={1}>
      {/* Cold moonlight from high and behind-left. */}
      <Lightformer
        intensity={2.6}
        color="#c9dbf2"
        position={[-4 * scale, 6 * scale, -3 * scale]}
        scale={[6 * scale, 6 * scale, 1]}
      />
      {/* Broad horizon fill, so the tower's seaward side is not pure black. */}
      <Lightformer
        form="ring"
        intensity={1.1}
        color="#2a4266"
        position={[0, 0.4 * scale, -8 * scale]}
        scale={[12 * scale, 3 * scale, 1]}
      />
      {/* A faint warm bounce off the water. */}
      <Lightformer
        intensity={0.5}
        color="#6b5a3f"
        rotation-x={Math.PI / 2}
        position={[0, -2 * scale, 0]}
        scale={[10 * scale, 10 * scale, 1]}
      />
    </Environment>
  );
}

interface Props {
  station: Station;
  /** Map pitch when the flight ended, so the 3D camera opens where the map left off. */
  entryPitchDeg?: number;
}

export default function Scene({ station, entryPitchDeg = 55 }: Props) {
  const heightM = station.tower_height_m ?? 12;
  const height = heightM * METRES;
  const isGeneric = (station.tower.evidence ?? 'default') !== 'photo';

  // Framing scales with the tower and only adds a small constant — towers range
  // 6 m to 54 m, so an absolute minimum distance renders the short ones as specks.
  // The generic scan is far wider than a bare tower — it includes rock and
  // outbuildings — so framing by height alone puts the camera inside the base.
  // Pull back far enough to clear its actual footprint.
  const footprint = isGeneric ? genericFootprintRadius(station.tower_height_m) : 0;
  // The generic model's tower stands off-centre on its pier, so the camera aims
  // at the tower's axis rather than the model's origin.
  const [axisX, axisZ] = isGeneric ? genericTowerAxis(station.tower_height_m) : [0, 0];
  const distance = Math.max(height * 3.5 + 0.8, footprint * 2.6);
  const elevation = clamp(90 - entryPitchDeg, 10, 32);
  const camY = height * 0.6 + Math.sin((elevation * Math.PI) / 180) * distance * 0.5;

  const seaRadius = height * 20 + 10;
  const skyRadius = seaRadius * 1.6;

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      shadows={false}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.35,
      }}
      camera={{ position: [distance * 0.8, camY, distance * 0.8], fov: 40, near: 0.05, far: skyRadius * 2.5 }}
    >
      <Ticker />

      <SkyDome radius={skyRadius} />
      <Stars radius={seaRadius * 1.2} depth={seaRadius * 0.4} count={900} factor={height * 0.6} fade speed={0} />
      <fog attach="fog" args={['#0a1526', distance * 2.2, seaRadius * 0.9]} />

      <NightEnvironment scale={Math.max(1, height)} />

      {/* Key and rim, on top of the environment: the environment gives shape,
          these give direction so the paint bands read as bands. */}
      <hemisphereLight args={['#3a5170', '#0a1420', 0.5]} />
      <directionalLight position={[-height * 3, height * 4, height * 2.5]} intensity={1.6} color="#cfe0f5" />
      <directionalLight position={[height * 3, height * 1.5, -height * 3]} intensity={0.7} color="#41597a" />

      <Moon distance={seaRadius * 0.45} scale={Math.max(0.5, height * 0.5)} />
      <Sea radius={seaRadius} scale={Math.max(1, height)} />
      <ContactShadows
        position={[0, 0.002, 0]}
        opacity={0.55}
        scale={height * 6}
        blur={2.4}
        far={height * 1.2}
        resolution={256}
        color="#000308"
      />

      {/* Stations we have photographed get a tower generated from their own
          paint scheme; the three we have not get the shared generic model,
          labelled as such in the drawer (Rule 6). */}
      {isGeneric ? (
        <Suspense fallback={null}>
          <GenericTower station={station} />
        </Suspense>
      ) : (
        <Tower station={station} />
      )}

      <EffectComposer enableNormalPass={false}>
        <Bloom
          // Only the lamp and the brightest paint should bleed.
          luminanceThreshold={0.72}
          luminanceSmoothing={0.28}
          intensity={0.9}
          mipmapBlur
        />
      </EffectComposer>

      <OrbitControls
        enablePan={false}
        minDistance={Math.max(height * 1.2 + 0.3, footprint * 1.1)}
        maxDistance={Math.max(height * 8 + 2, footprint * 5)}
        maxPolarAngle={Math.PI / 2 - 0.04}
        target={[axisX, height * 0.48, axisZ]}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
