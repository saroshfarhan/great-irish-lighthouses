/**
 * The supplied generic lighthouse model, used where we have no photograph.
 *
 * WHERE THIS IS USED, AND WHY ONLY THERE
 *
 * 62 of the 65 towers are generated from their own photographs — Hook Head's
 * bands, Fastnet's granite, St John's Point's black and yellow. A single shared
 * model would throw all of that away. It is used for exactly the three stations
 * whose photographs show no usable elevation (`evidence !== 'photo'`), which is
 * precisely the case Rule 6 exists for: a representation, clearly labelled.
 *
 * TWO THINGS THE FILE NEEDED FIXING
 *
 * 1. **The texture was bound as `emissiveTexture`,** with `baseColorFactor`
 *    black and `emissiveFactor` white — a photogrammetry export convention that
 *    renders the model fully unlit. Dropped into our scene it would have been a
 *    flat cut-out with no shading, sitting beside towers that respond to the
 *    moonlight. We rebind it as the base-colour map so it lights properly.
 *
 * 2. **Scale.** The model is unit-sized (1.6 × 1.2 × 1.9). Its geometry shows a
 *    broad base for the lower ~60% and a slender tower above, so scaling its
 *    whole bounding box to the published tower height would render the tower
 *    itself far too short. `TOWER_FRACTION` corrects for that.
 *
 * The file is in `public/`, not imported, so its 2 MB is fetched only when one
 * of those three stations is opened — never on first load.
 */

import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import type { Station } from '../lib/stations';
import { Beam } from './Beam';
import { METRES } from './buildProfile';

const MODEL_URL = '/models/generic-lighthouse.glb';

/**
 * Fraction of the model's total height occupied by the tower itself, measured
 * from the vertex distribution: the cross-section steps from radius 0.86 to
 * 0.30 at 60% height, so the tower is roughly the top 40%.
 */
const TOWER_FRACTION = 0.4;

/**
 * The model's bounding box, measured from its POSITION accessor.
 *
 * Recorded here because the camera has to be framed *before* the model has
 * loaded, and because the shape is the surprising part: the scan is far wider
 * than it is tall (1.9 deep against 1.16 high), since it includes the rock and
 * outbuildings, not just the tower. Scaling the tower to its true height
 * therefore produces a footprint several times the tower's height — which put
 * the camera inside the rock on the first attempt.
 */
export const GENERIC_MODEL_SIZE = { x: 1.623, y: 1.157, z: 1.905 };

/**
 * Where the lantern actually is inside the model, measured from the mesh.
 *
 * **The tower is not on the model's origin.** Slicing the vertices by height
 * gives a consistent tower axis at x ≈ 0.000, **z ≈ +0.186** — the lighthouse
 * stands off-centre on its pier, while the bounding-box centre is z ≈ +0.003.
 * Putting the light at the local origin therefore hung it in mid-air beside the
 * tower rather than inside the lantern.
 *
 * `heightFrac` is 0.90, not 1.0: the topmost 3% of the model is the finial
 * spike (radius 0.015). The lantern room proper sits around 0.85–0.95, where
 * the cross-section is ~0.09.
 *
 * All values are in model units, before scaling.
 */
export const GENERIC_LANTERN = {
  x: 0.0,
  z: 0.186,
  heightFrac: 0.9,
  radius: 0.095,
};

function scaleFor(towerHeightM: number | null | undefined): number {
  const targetTower = (towerHeightM ?? 12) * METRES;
  return targetTower / (GENERIC_MODEL_SIZE.y * TOWER_FRACTION);
}

/** World-unit radius the model occupies once scaled for a given tower height. */
export function genericFootprintRadius(towerHeightM: number | null | undefined): number {
  return (Math.max(GENERIC_MODEL_SIZE.x, GENERIC_MODEL_SIZE.z) / 2) * scaleFor(towerHeightM);
}

/**
 * The tower's axis in world units, for the camera to orbit and aim at. Without
 * it the view rotates about the pier's centre and the lighthouse swings around
 * the frame instead of staying put.
 */
export function genericTowerAxis(towerHeightM: number | null | undefined): [number, number] {
  const scale = scaleFor(towerHeightM);
  return [GENERIC_LANTERN.x * scale, GENERIC_LANTERN.z * scale];
}

export function GenericTower({ station }: { station: Station }) {
  const gltf = useGLTF(MODEL_URL);

  /**
   * Clone per station so two open drawers cannot fight over one material, and
   * so our material edits never mutate the cached original.
   */
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  const { scale, height } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);

    const towerMetres = station.tower_height_m ?? 12;
    const targetTower = towerMetres * METRES;

    // Scale so the *tower portion* matches the published height, not the whole
    // scan — which includes the rock and outbuildings beneath it.
    const modelTowerHeight = Math.max(0.001, size.y * TOWER_FRACTION);
    const s = targetTower / modelTowerHeight;

    return { scale: s, height: size.y * s };
  }, [scene, station.tower_height_m]);

  // Rebind the emissive texture as the base-colour map so the model is lit by
  // the scene rather than glowing at full brightness on its own.
  useEffect(() => {
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      const source = object.material as THREE.MeshStandardMaterial;
      const texture = source.emissiveMap ?? source.map;
      if (texture) texture.colorSpace = THREE.SRGBColorSpace;

      object.material = new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        roughness: 0.85,
        metalness: 0.02,
        envMapIntensity: 0.9,
        // A trace of self-illumination keeps the unlit side from going to pure
        // black on a night scene, without returning it to a flat cut-out.
        emissiveMap: texture,
        emissive: new THREE.Color(0x0a0f18),
        emissiveIntensity: 0.35,
        side: THREE.FrontSide,
      });

      source.dispose();
    });
  }, [scene]);

  // The scan is centred on its own origin; sit it on the sea instead.
  const box = useMemo(() => new THREE.Box3().setFromObject(scene), [scene]);
  const yOffset = -box.min.y * scale;

  return (
    <group>
      <primitive object={scene} scale={scale} position={[0, yOffset, 0]} />

      {/* Offset onto the tower's own axis before raising the light, so the lamp
          sits inside the lantern rather than floating beside it. */}
      <group position={[GENERIC_LANTERN.x * scale, 0, GENERIC_LANTERN.z * scale]}>
        <Beam
          station={station}
          focalHeight={height * GENERIC_LANTERN.heightFrac}
          radius={GENERIC_LANTERN.radius * scale}
        />
      </group>
    </group>
  );
}

// Fetched on demand, not preloaded: only three stations use it, and the file is
// 2 MB. `useGLTF.preload(MODEL_URL)` here would pull it on every drawer open.
