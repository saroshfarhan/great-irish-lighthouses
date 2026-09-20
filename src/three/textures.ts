/**
 * Small procedural textures, generated on a canvas at runtime.
 *
 * Generated rather than shipped because they are noise — there is no point
 * spending bytes on a file that a loop can produce, and it keeps the 3D chunk
 * free of binary assets.
 */

import * as THREE from 'three';

/** Cheap 2D value noise with smooth interpolation. */
function valueNoise(width: number, height: number, cells: number, seed = 1): Float32Array {
  const grid = new Float32Array((cells + 1) * (cells + 1));
  let s = seed;
  const rand = () => {
    // Deterministic: the same tower looks the same every time it is opened.
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();

  const smooth = (t: number) => t * t * (3 - 2 * t);
  const out = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const fx = (x / width) * cells;
      const fy = (y / height) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);

      const g = (gx: number, gy: number) => grid[(gy % (cells + 1)) * (cells + 1) + (gx % (cells + 1))] ?? 0;
      const top = g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx;
      const bottom = g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx;
      out[y * width + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/**
 * A normal map of gentle swell, for the sea.
 *
 * This is what stops the water reading as a sheet of dark glass: the reflection
 * of the tower breaks up across the ripples, which is most of what makes a
 * night seascape look like water.
 */
export function seaNormalMap(size = 256): THREE.DataTexture {
  // Two octaves: long swell plus a finer chop on top.
  const coarse = valueNoise(size, size, 6, 7);
  const fine = valueNoise(size, size, 18, 23);

  const heightAt = (x: number, y: number) => {
    const i = (((y % size) + size) % size) * size + (((x % size) + size) % size);
    return (coarse[i] ?? 0) * 0.75 + (fine[i] ?? 0) * 0.25;
  };

  const data = new Uint8Array(size * size * 4);
  const strength = 2.4;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Central differences give the surface gradient; the normal is its cross.
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength;

      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);

      const i = (y * size + x) * 4;
      data[i] = ((nx / length) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / length) * 0.5 + 0.5) * 255;
      data[i + 2] = ((nz / length) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  texture.needsUpdate = true;
  return texture;
}

/**
 * A subtle weathering map for the tower's paint.
 *
 * Applied as a roughness map, so lime render looks worn by salt rather than
 * factory-fresh. Very low contrast on purpose — these towers are maintained.
 */
export function weatheringMap(size = 128): THREE.DataTexture {
  const noise = valueNoise(size, size, 9, 41);
  const data = new Uint8Array(size * size * 4);

  for (let i = 0; i < size * size; i += 1) {
    // Bias toward rough; the variation is what matters, not the absolute value.
    const v = 150 + (noise[i] ?? 0.5) * 90;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.needsUpdate = true;
  return texture;
}
