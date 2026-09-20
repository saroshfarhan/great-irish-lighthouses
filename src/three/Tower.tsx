/**
 * One procedurally generated lighthouse.
 *
 * The detail here is deliberate, not decoration. A lighthouse reads as a
 * lighthouse because of a small number of specific features — the flared
 * granite base, the projecting gallery with its railing, the glazed lantern
 * with vertical astragals, the domed roof and finial. Leave those out and you
 * have a striped cylinder, which is what the first pass looked like.
 *
 * Everything is memoised per station and disposed on unmount: this scene mounts
 * and unmounts on every drawer open, so a leaked LatheGeometry leaks one per click.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import type { Station } from '../lib/stations';
import { Beam } from './Beam';
import { bandTexture, buildTower, METRES } from './buildProfile';
import { weatheringMap } from './textures';

interface Props {
  station: Station;
}

export function Tower({ station }: Props) {
  const build = useMemo(
    () => buildTower(station.tower, station.tower_height_m),
    [station.tower, station.tower_height_m],
  );

  const { dims, profile, focalHeight } = build;
  const shape = station.tower.shape ?? 'tapered';

  const texture = useMemo(
    () => bandTexture(station.tower.body_colour ?? '#e9e5dc', station.tower.bands),
    [station.tower],
  );

  const geometry = useMemo(() => {
    if (shape === 'square' || shape === 'box') {
      const side = dims.baseRadius * 1.7;
      const box = new THREE.BoxGeometry(side, dims.height, side, 1, 4, 1);
      box.translate(0, dims.height / 2, 0);
      return box;
    }
    // 64 radial segments: at this camera distance 48 left visible facets on the
    // silhouette, which is a large part of what made it look untextured.
    const lathe = new THREE.LatheGeometry(profile, 64);
    lathe.computeVertexNormals();
    return lathe;
  }, [shape, profile, dims]);

  /** Salt-worn paint, generated rather than shipped. */
  const roughnessMap = useMemo(() => weatheringMap(), []);

  /** Painted lime render over masonry: matte, very slightly waxy, never metallic. */
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        map: texture,
        roughnessMap,
        roughness: 0.66,
        metalness: 0.0,
        clearcoat: 0.16,
        clearcoatRoughness: 0.72,
        envMapIntensity: 0.95,
        side: THREE.DoubleSide,
      }),
    [texture, roughnessMap],
  );

  const metalMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: station.tower.gallery_colour ?? '#a8332c',
        roughness: 0.42,
        metalness: 0.65,
        envMapIntensity: 1.1,
      }),
    [station.tower.gallery_colour],
  );

  const lanternMetal = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: station.tower.lantern_colour ?? '#1b1c20',
        roughness: 0.34,
        metalness: 0.78,
        envMapIntensity: 1.2,
      }),
    [station.tower.lantern_colour],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      metalMaterial.dispose();
      lanternMetal.dispose();
      texture.dispose();
      roughnessMap.dispose();
    },
    [geometry, material, metalMaterial, lanternMetal, texture, roughnessMap],
  );

  const { height, baseRadius, topRadius } = dims;
  const galleryRadius = topRadius * 1.62;
  const lanternHeight = topRadius * 2.3;
  const railHeight = topRadius * 0.85;
  const posts = 16;
  const astragals = 12;

  return (
    <group>
      {/* Rock the tower stands on — grounds it, and most Irish stations are on
          rock or a raised plinth rather than flat ground. */}
      <mesh position={[0, -height * 0.02, 0]}>
        <cylinderGeometry args={[baseRadius * 2.1, baseRadius * 2.7, height * 0.07, 24]} />
        <meshStandardMaterial color="#2a2f36" roughness={0.95} metalness={0.02} />
      </mesh>

      {/* Plinth: the slight flare where the tower meets its base. */}
      <mesh position={[0, height * 0.012, 0]}>
        <cylinderGeometry args={[baseRadius * 1.12, baseRadius * 1.28, height * 0.045, 48]} />
        <meshStandardMaterial color="#8e8b84" roughness={0.88} metalness={0.02} />
      </mesh>

      {/* Tower shaft */}
      <mesh geometry={geometry} material={material} />

      {/* Lattice masts are an open frame, not a solid shaft. */}
      {shape === 'lattice' ? (
        <group>
          {[0, 1, 2, 3].map((i) => (
            <mesh
              key={i}
              position={[0, height / 2, 0]}
              rotation={[0, (i * Math.PI) / 2, i % 2 === 0 ? 0.08 : -0.08]}
              material={lanternMetal}
            >
              <boxGeometry args={[baseRadius * 0.1, height, baseRadius * 0.1]} />
            </mesh>
          ))}
        </group>
      ) : null}

      {/* Door, and a column of windows up the shaft. Tiny, but they give the
          tower a human scale — without them nothing says how big it is. */}
      {shape !== 'lattice' && shape !== 'box' ? (
        <>
          <mesh position={[baseRadius * 0.99, height * 0.055, 0]} material={lanternMetal}>
            <boxGeometry args={[baseRadius * 0.12, height * 0.075, baseRadius * 0.42]} />
          </mesh>
          {[0.3, 0.52, 0.74].map((f) => (
            <mesh
              key={f}
              position={[
                Math.cos(f * 7) * (THREE.MathUtils.lerp(baseRadius, topRadius, f) * 0.98),
                height * f,
                Math.sin(f * 7) * (THREE.MathUtils.lerp(baseRadius, topRadius, f) * 0.98),
              ]}
              rotation={[0, -f * 7, 0]}
              material={lanternMetal}
            >
              <boxGeometry args={[topRadius * 0.1, height * 0.035, topRadius * 0.3]} />
            </mesh>
          ))}
        </>
      ) : null}

      {/* Gallery: deck, railing posts and handrail. */}
      {(station.tower.galleries ?? 1) > 0 ? (
        <group position={[0, height, 0]}>
          <mesh material={metalMaterial}>
            <cylinderGeometry args={[galleryRadius, galleryRadius * 0.96, height * 0.016, 48]} />
          </mesh>
          {/* Corbels under the deck, the way a real gallery is carried. */}
          <mesh position={[0, -height * 0.022, 0]} material={metalMaterial}>
            <cylinderGeometry args={[galleryRadius * 0.96, topRadius * 1.02, height * 0.028, 48]} />
          </mesh>

          {Array.from({ length: posts }, (_, i) => {
            const a = (i / posts) * Math.PI * 2;
            return (
              <mesh
                key={i}
                position={[Math.cos(a) * galleryRadius * 0.94, railHeight / 2, Math.sin(a) * galleryRadius * 0.94]}
                material={metalMaterial}
              >
                <cylinderGeometry args={[topRadius * 0.022, topRadius * 0.022, railHeight, 6]} />
              </mesh>
            );
          })}

          <mesh position={[0, railHeight, 0]} rotation={[Math.PI / 2, 0, 0]} material={metalMaterial}>
            <torusGeometry args={[galleryRadius * 0.94, topRadius * 0.035, 8, 48]} />
          </mesh>
          <mesh position={[0, railHeight * 0.55, 0]} rotation={[Math.PI / 2, 0, 0]} material={metalMaterial}>
            <torusGeometry args={[galleryRadius * 0.94, topRadius * 0.018, 6, 48]} />
          </mesh>
        </group>
      ) : null}

      {/* Lantern room. */}
      <group position={[0, height + lanternHeight * 0.5, 0]}>
        {/* Glazing */}
        <mesh>
          <cylinderGeometry args={[topRadius * 1.02, topRadius * 1.02, lanternHeight, 24]} />
          <meshPhysicalMaterial
            color="#b9d4ea"
            roughness={0.05}
            metalness={0}
            transmission={0.92}
            thickness={topRadius * 0.4}
            ior={1.45}
            transparent
            opacity={0.35}
            envMapIntensity={1.4}
          />
        </mesh>

        {/* Astragals — real bars, not a wireframe material. This is the single
            detail that most says "lantern" rather than "glass tube". */}
        {Array.from({ length: astragals }, (_, i) => {
          const a = (i / astragals) * Math.PI * 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * topRadius * 1.03, 0, Math.sin(a) * topRadius * 1.03]}
              material={lanternMetal}
            >
              <boxGeometry args={[topRadius * 0.05, lanternHeight, topRadius * 0.05]} />
            </mesh>
          );
        })}
        {/* Top and bottom rings of the lantern frame. */}
        {[-lanternHeight / 2, lanternHeight / 2].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={lanternMetal}>
            <torusGeometry args={[topRadius * 1.04, topRadius * 0.05, 8, 32]} />
          </mesh>
        ))}

        {/* Domed roof, vent and finial. */}
        <mesh position={[0, lanternHeight * 0.5 + topRadius * 0.42, 0]} material={lanternMetal}>
          <sphereGeometry args={[topRadius * 1.12, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh position={[0, lanternHeight * 0.5 + topRadius * 0.78, 0]} material={lanternMetal}>
          <cylinderGeometry args={[topRadius * 0.12, topRadius * 0.18, topRadius * 0.34, 12]} />
        </mesh>
        <mesh position={[0, lanternHeight * 0.5 + topRadius * 1.0, 0]} material={lanternMetal}>
          <sphereGeometry args={[topRadius * 0.11, 12, 12]} />
        </mesh>
      </group>

      {/* Keeper's dwelling. */}
      {station.tower.has_dwelling ? (
        <group position={[baseRadius * 3.1, 0, baseRadius * 0.8]}>
          <mesh position={[0, 2.1 * METRES, 0]}>
            <boxGeometry args={[9 * METRES, 4.2 * METRES, 6 * METRES]} />
            <meshStandardMaterial color="#ddd8cc" roughness={0.92} metalness={0.01} />
          </mesh>
          <mesh position={[0, 4.9 * METRES, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[6.4 * METRES, 2.1 * METRES, 4]} />
            <meshStandardMaterial color="#33383f" roughness={0.9} metalness={0.05} />
          </mesh>
          {/* Boundary wall — these stations are always walled against the sea. */}
          <mesh position={[0, 0.9 * METRES, 5.5 * METRES]}>
            <boxGeometry args={[14 * METRES, 1.8 * METRES, 0.5 * METRES]} />
            <meshStandardMaterial color="#cfc9bc" roughness={0.95} />
          </mesh>
        </group>
      ) : null}

      <Beam station={station} focalHeight={focalHeight} radius={topRadius} />
    </group>
  );
}
