// Heightfield: generated once from the map definition, sampled at 1 m,
// read with bilinear interpolation. Derived data; not part of saved state.

import type { MapDef } from '../data/map';
import { SCENERY } from '../data/tunables';
import { fbm, smoothstep } from './noise';
import { hash2 } from './rng';

export interface Terrain {
  size: number;
  /** Samples per side (size + 1). */
  n: number;
  heights: Float32Array;
  /** Deposit index per 1 m cell, -1 if none. */
  depositCell: Int16Array;
  /** Trees and boulders, in a fixed order; state records which have been cleared. */
  scenery: Scenery[];
  map: MapDef;
}

export type SceneryKind = 'tree' | 'snag' | 'boulder';

export interface Scenery {
  kind: SceneryKind;
  x: number;
  z: number;
  /** Radius that blocks haulers, metres. */
  r: number;
  /** Size multiplier and rotation, for drawing. */
  s: number;
  rot: number;
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
  const t: Terrain = { size, n, heights, depositCell, scenery: [], map };
  t.scenery = generateScenery(t);
  return t;
}

/** How wooded a point is: above SCENERY.forestLevel, trees grow. */
export function forestAt(map: MapDef, x: number, z: number): number {
  return fbm(x, z, map.seed + 911, 46, 3);
}

function sceneryAllowed(t: Terrain, x: number, z: number, hubClear: number, depositClear: number, maxSlope: number): boolean {
  const map = t.map;
  if (x < 5 || z < 5 || x > t.size - 5 || z > t.size - 5) return false;
  if (Math.hypot(x - map.hub.x, z - map.hub.z) < hubClear) return false;
  for (const d of map.deposits) if (Math.hypot(x - d.x, z - d.z) < d.r + depositClear) return false;
  return cellSlope(t, Math.floor(x), Math.floor(z)) <= maxSlope;
}

function generateScenery(t: Terrain): Scenery[] {
  const map = t.map;
  const out: Scenery[] = [];
  const S = SCENERY;
  const seed = map.seed ^ 0x51ce;
  const g = S.treeGrid;
  for (let j = 0; j * g < t.size; j++) {
    for (let i = 0; i * g < t.size; i++) {
      const x = (i + 0.15 + 0.7 * hash2(i, j, seed)) * g;
      const z = (j + 0.15 + 0.7 * hash2(i, j, seed + 1)) * g;
      const f = forestAt(map, x, z);
      const chance = f > S.forestLevel ? Math.min(1, (f - S.forestLevel) * 5) * S.forestDensity : S.loneTree;
      if (hash2(i, j, seed + 2) >= chance) continue;
      if (!sceneryAllowed(t, x, z, S.hubClear, S.depositClear, S.maxSlope)) continue;
      const dead = hash2(i, j, seed + 3) < S.snags;
      out.push({ kind: dead ? 'snag' : 'tree', x, z, r: 0.6, s: 0.72 + 0.6 * hash2(i, j, seed + 4), rot: hash2(i, j, seed + 5) * Math.PI * 2 });
    }
  }
  const b = S.boulderGrid;
  for (let j = 0; j * b < t.size; j++) {
    for (let i = 0; i * b < t.size; i++) {
      if (hash2(i, j, seed + 10) >= S.boulderChance) continue;
      const x = (i + hash2(i, j, seed + 11)) * b;
      const z = (j + hash2(i, j, seed + 12)) * b;
      if (!sceneryAllowed(t, x, z, S.hubClear * 0.7, 3, 0.5)) continue;
      const s = 0.9 + 1.4 * hash2(i, j, seed + 13);
      out.push({ kind: 'boulder', x, z, r: s * 0.55, s, rot: hash2(i, j, seed + 14) * Math.PI * 2 });
    }
  }
  return out;
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
