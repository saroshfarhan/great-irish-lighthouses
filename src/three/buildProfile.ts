/**
 * Turn a station's published attributes into tower geometry.
 *
 * Nothing here is modelled by hand. Each tower is a silhouette revolved about
 * its axis, sized from the real published tower height and painted from the
 * scheme read off that station's photographs. That is how 65 distinct towers
 * come out of one generator: Hook Head gets its broad black bands, Fastnet its
 * bare grey granite, Kish Bank its caisson, because the data says so.
 *
 * Honest about its limits: proportion, height, colour scheme and light
 * behaviour are real; rivet-level detail is not. Where the data says the
 * profile is `generic`, the app says so too (CLAUDE.md Rule 6).
 */

import * as THREE from 'three';

import type { Band, Tower } from '../data/schema.gen';

/** World units per real metre. Keeps the scene comfortable for the camera. */
export const METRES = 0.1;

/** Fallback when a station publishes no tower height (three box structures). */
const DEFAULT_HEIGHT_M = 12;

export interface TowerDimensions {
  /** Tower height in world units. */
  height: number;
  /** Radius at the base, in world units. */
  baseRadius: number;
  /** Radius just under the gallery. */
  topRadius: number;
}

/**
 * Real lighthouses are far more slender than intuition suggests — Fastnet is
 * 54 m tall and about 6 m across at the top. Deriving radius from height with a
 * gentle power curve keeps a 6 m harbour light from looking like a pencil and a
 * 54 m rock tower from looking like a silo.
 */
export function dimensionsFor(shape: string, heightM: number | null | undefined): TowerDimensions {
  const metres = heightM && heightM > 0 ? heightM : DEFAULT_HEIGHT_M;
  const height = metres * METRES;

  // Squat structures are wide for their height; tall towers are proportionally slimmer.
  const slenderness = Math.pow(metres, 0.45) * 0.28;

  switch (shape) {
    case 'box':
      return { height: height * 0.8, baseRadius: slenderness * 1.5, topRadius: slenderness * 1.5 };
    case 'lattice':
      return { height, baseRadius: slenderness * 1.1, topRadius: slenderness * 0.5 };
    case 'caisson':
      return { height, baseRadius: slenderness * 2.2, topRadius: slenderness * 1.1 };
    case 'square':
      return { height, baseRadius: slenderness * 1.15, topRadius: slenderness * 1.0 };
    case 'conical':
      return { height, baseRadius: slenderness * 1.25, topRadius: slenderness * 0.72 };
    case 'cylindrical':
      return { height, baseRadius: slenderness, topRadius: slenderness * 0.94 };
    case 'tapered':
    default:
      return { height, baseRadius: slenderness * 1.2, topRadius: slenderness * 0.62 };
  }
}

/**
 * The 2D silhouette, as points in (radius, height), to be revolved.
 *
 * The concave curve on a rock tower is the characteristic profile of a
 * wave-swept lighthouse — the flare at the base breaks the sea. Drawing it as a
 * straight cone is the single thing that most makes a generated lighthouse look
 * wrong, so tapered towers get a real curve.
 */
export function silhouette(shape: string, dims: TowerDimensions, segments = 24): THREE.Vector2[] {
  const { height, baseRadius, topRadius } = dims;
  const points: THREE.Vector2[] = [];

  if (shape === 'caisson') {
    // A wide concrete drum with a narrower tower rising from it.
    points.push(new THREE.Vector2(0, 0));
    points.push(new THREE.Vector2(baseRadius, 0));
    points.push(new THREE.Vector2(baseRadius, height * 0.26));
    points.push(new THREE.Vector2(baseRadius * 0.62, height * 0.32));
    points.push(new THREE.Vector2(topRadius, height * 0.42));
    points.push(new THREE.Vector2(topRadius, height));
    return points;
  }

  points.push(new THREE.Vector2(0, 0));

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    let radius: number;

    if (shape === 'cylindrical') {
      radius = THREE.MathUtils.lerp(baseRadius, topRadius, t);
    } else if (shape === 'conical') {
      radius = THREE.MathUtils.lerp(baseRadius, topRadius, t);
    } else {
      // Concave flare: fast narrowing low down, near-vertical higher up.
      const curve = 1 - Math.pow(1 - t, 2.1);
      radius = THREE.MathUtils.lerp(baseRadius, topRadius, curve);
    }

    points.push(new THREE.Vector2(radius, height * t));
  }

  return points;
}

/**
 * A stripe texture for the tower's paint scheme.
 *
 * Bands are published as fractions of height, so they map directly onto the
 * lathe's V coordinate. Generating this rather than shipping 65 textures is
 * what makes the paint scheme *data*.
 */
export function bandTexture(
  bodyColour: string,
  bands: Band[] | undefined,
  height = 512,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bodyColour;
    ctx.fillRect(0, 0, canvas.width, height);

    for (const band of bands ?? []) {
      // Canvas Y runs from the top; the tower's V runs from the base.
      const y0 = (1 - band.to_frac) * height;
      const y1 = (1 - band.from_frac) * height;
      ctx.fillStyle = band.colour;
      ctx.fillRect(0, y0, canvas.width, y1 - y0);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/** Everything the scene needs to place a camera and a beam for this tower. */
export interface TowerBuild {
  dims: TowerDimensions;
  profile: THREE.Vector2[];
  /** Height of the lantern's focal plane, in world units. */
  focalHeight: number;
  isGeneric: boolean;
}

export function buildTower(tower: Tower, towerHeightM: number | null | undefined): TowerBuild {
  const shape = tower.shape ?? 'tapered';
  const dims = dimensionsFor(shape, towerHeightM);
  return {
    dims,
    profile: silhouette(shape, dims),
    focalHeight: dims.height + dims.topRadius * 0.9,
    isGeneric: (tower.evidence ?? 'default') !== 'photo',
  };
}
