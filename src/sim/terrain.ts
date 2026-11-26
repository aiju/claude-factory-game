// Heightfield: generated once from the map definition, sampled at 1 m,
// read with bilinear interpolation. Derived data; not part of saved state.

import type { MapDef } from '../data/map';
import { fbm, smoothstep } from './noise';

export interface Terrain {
  size: number;
  /** Samples per side (size + 1). */
  n: number;
  heights: Float32Array;
  /** Deposit index per 1 m cell, -1 if none. */
  depositCell: Int16Array;
  map: MapDef;
}

function plateauLift(map: MapDef, x: number, z: number): number {
  let lift = 0;
  for (const p of map.plateaus) {
    const dx = x - p.x;
    const dz = z - p.z;
    const c = Math.cos(-p.rot);
    const s = Math.sin(-p.rot);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const d = Math.hypot(lx / p.rx, lz / p.rz);
    // Wobble the outline a little so it doesn't look drawn with a compass.
    const wobble = fbm(x, z, map.seed + 77, 18, 2) * 0.08;
    const signed = (d - 1 + wobble) * Math.min(p.rx, p.rz); // ≈ metres outside the edge
    const ang = Math.atan2(dz, dx);
    let da = Math.abs(ang - p.ramp.angle) % (Math.PI * 2);
    if (da > Math.PI) da = Math.PI * 2 - da;
    const rampW = 1 - smoothstep(p.ramp.arc * 0.6, p.ramp.arc, da);
    const w = p.cliff + (p.ramp.width - p.cliff) * rampW;
    // The ramp extends outward from the edge, the cliff sits on it.
    const outer = rampW * w;
    const t = 1 - smoothstep(-p.cliff * 0.5 * (1 - rampW), outer + p.cliff * 0.5 * (1 - rampW), signed);
    lift = Math.max(lift, p.height * t);
  }
  return lift;
}

export function generateHeight(map: MapDef, x: number, z: number): number {
  let h = map.baseHeight;
  for (let i = 0; i < map.noise.length; i++) {
    const o = map.noise[i];
    h += fbm(x, z, map.seed + i * 31, o.scale, 3) * o.amp;
  }
  for (const f of map.flats) {
    const d = Math.hypot(x - f.x, z - f.z);
    const t = 1 - smoothstep(f.r, f.r + f.falloff, d);
    h = h + (map.baseHeight - h) * t;
  }
  h += plateauLift(map, x, z);
  // Settle to the base level near the map edge, so the world meets the
  // surrounding skirt cleanly.
  const edge = Math.min(x, z, map.size - x, map.size - z);
  const e = smoothstep(0, 14, edge);
  return map.baseHeight + (h - map.baseHeight) * e;
}

export function createTerrain(map: MapDef): Terrain {
  const size = map.size;
  const n = size + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      heights[j * n + i] = generateHeight(map, i, j);
    }
  }
  const depositCell = new Int16Array(size * size).fill(-1);
  map.deposits.forEach((d, k) => {
    const r = Math.ceil(d.r);
    for (let j = Math.floor(d.z) - r; j <= Math.floor(d.z) + r; j++) {
      for (let i = Math.floor(d.x) - r; i <= Math.floor(d.x) + r; i++) {
        if (i < 0 || j < 0 || i >= size || j >= size) continue;
        if (Math.hypot(i + 0.5 - d.x, j + 0.5 - d.z) <= d.r) depositCell[j * size + i] = k;
      }
    }
  });
  return { size, n, heights, depositCell, map };
}

export function heightAt(t: Terrain, x: number, z: number): number {
  const max = t.size - 1e-6;
  const cx = Math.min(max, Math.max(0, x));
  const cz = Math.min(max, Math.max(0, z));
  const i = Math.floor(cx);
  const j = Math.floor(cz);
  const fx = cx - i;
  const fz = cz - j;
  const n = t.n;
  const h00 = t.heights[j * n + i];
  const h10 = t.heights[j * n + i + 1];
  const h01 = t.heights[(j + 1) * n + i];
  const h11 = t.heights[(j + 1) * n + i + 1];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/** Slope magnitude (rise over run) of the 1 m cell containing (x, z). */
export function cellSlope(t: Terrain, i: number, j: number): number {
  const n = t.n;
  const h00 = t.heights[j * n + i];
  const h10 = t.heights[j * n + i + 1];
  const h01 = t.heights[(j + 1) * n + i];
  const h11 = t.heights[(j + 1) * n + i + 1];
  const gx = (h10 - h00 + h11 - h01) * 0.5;
  const gz = (h01 - h00 + h11 - h10) * 0.5;
  return Math.hypot(gx, gz);
}

/** Index into map.deposits at a world point, or -1. */
export function depositAt(t: Terrain, x: number, z: number): number {
  const i = Math.floor(x);
  const j = Math.floor(z);
  if (i < 0 || j < 0 || i >= t.size || j >= t.size) return -1;
  return t.depositCell[j * t.size + i];
}
