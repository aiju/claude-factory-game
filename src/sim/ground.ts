// The ground remembers: per-cell wear from passing haulers, which becomes
// tracks and roads (faster, and preferred by pathfinding), and a smoothed
// crowd density, which slows bots and makes jams costly to path through.

import { CROWD, WEAR } from '../data/tunables';
import type { Sim } from './world';

export interface Ground {
  /** Cells per side. */
  size: number;
  wear: Float32Array;
  /** 0 none, 1 track, 2 road. */
  level: Uint8Array;
  /** Smoothed number of haulers in each cell's 3×3 block. */
  crowd: Float32Array;
}

export function createGround(size: number): Ground {
  return {
    size,
    wear: new Float32Array(size * size),
    level: new Uint8Array(size * size),
    crowd: new Float32Array(size * size),
  };
}

/** Speed multiplier of the ground at a point. */
export function groundSpeed(g: Ground, x: number, z: number): number {
  const i = Math.floor(x);
  const j = Math.floor(z);
  if (i < 0 || j < 0 || i >= g.size || j >= g.size) return 1;
  return WEAR.speed[g.level[j * g.size + i]];
}

/** Speed factor from crowding at a point (1 when comfortable). */
export function crowdFactor(g: Ground, x: number, z: number): number {
  const i = Math.floor(x);
  const j = Math.floor(z);
  if (i < 0 || j < 0 || i >= g.size || j >= g.size) return 1;
  const excess = g.crowd[j * g.size + i] - CROWD.comfortable;
  return excess > 0 ? 1 / (1 + CROWD.slow * excess) : 1;
}

/** Path cost of one metre through cell k, before slope. */
export function cellTravelCost(g: Ground, k: number): number {
  const excess = g.crowd[k] - CROWD.comfortable;
  return 1 / WEAR.speed[g.level[k]] + (excess > 0 ? CROWD.pathCost * excess : 0);
}

/** Lowest possible cost per metre, for an admissible A* heuristic. */
export const MIN_TRAVEL_COST = 1 / Math.max(...WEAR.speed);

/** A bot moved `dist` metres and is now at (x, z): wear the ground around it. */
export function addWear(g: Ground, x: number, z: number, dist: number) {
  const r = WEAR.spread;
  const n = g.size;
  const i0 = Math.max(0, Math.floor(x - r));
  const i1 = Math.min(n - 1, Math.floor(x + r));
  const j0 = Math.max(0, Math.floor(z - r));
  const j1 = Math.min(n - 1, Math.floor(z + r));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - z);
      if (d >= r) continue;
      const k = j * n + i;
      // Full wear along the wheel line, tapering to nothing at the spread.
      const w = g.wear[k] + dist * (1 - (d / r) * (d / r));
      g.wear[k] = w > WEAR.max ? WEAR.max : w;
    }
  }
}

const decayCache = new Map<number, number[]>();
function decayFactors(ticks: number): number[] {
  let f = decayCache.get(ticks);
  if (!f) {
    const dt = ticks / 30;
    f = WEAR.halfLife.map((h) => Math.pow(0.5, dt / h));
    decayCache.set(ticks, f);
  }
  return f;
}

/** Decay wear and move cells between levels. Returns true if any level changed. */
export function updateWear(g: Ground): boolean {
  const f = decayFactors(WEAR.interval);
  let changed = false;
  const { wear, level } = g;
  for (let k = 0; k < wear.length; k++) {
    let w = wear[k];
    if (w === 0) continue;
    const l = level[k];
    w *= f[l];
    if (w < 0.01) w = 0;
    wear[k] = w;
    let nl = l;
    if (l === 0 && w >= WEAR.trackOn) nl = 1;
    if (nl === 1 && w >= WEAR.roadOn) nl = 2;
    if (l === 2 && w < WEAR.roadOff) nl = 1;
    if (nl === 1 && w < WEAR.trackOff) nl = 0;
    if (nl !== l) {
      level[k] = nl;
      changed = true;
    }
  }
  return changed;
}

/** Fold the current hauler positions into the smoothed crowd field. */
export function updateCrowd(sim: Sim) {
  const g = sim.state.ground;
  const n = g.size;
  const a = Math.exp(-CROWD.interval / 30 / CROWD.tau);
  const c = g.crowd;
  for (let k = 0; k < c.length; k++) {
    if (c[k] === 0) continue;
    const v = c[k] * a;
    c[k] = v < 0.002 ? 0 : v;
  }
  const add = 1 - a;
  for (const h of sim.state.haulers) {
    // Parked bots are not traffic.
    if (h.mode === 'idle') continue;
    const i = Math.floor(h.x);
    const j = Math.floor(h.z);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        c[jj * n + ii] += add;
      }
    }
  }
}

export function tickGround(sim: Sim) {
  const t = sim.state.tick;
  if (t % CROWD.interval === 0) updateCrowd(sim);
  if (t % WEAR.interval === 0 && updateWear(sim.state.ground)) sim.d.groundVersion++;
}

// ---------------------------------------------------------------------------
// Serialisation: typed arrays travel as base64 strings.

function toB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeGround(g: Ground) {
  return {
    size: g.size,
    wear: toB64(new Uint8Array(g.wear.buffer, g.wear.byteOffset, g.wear.byteLength)),
    level: toB64(g.level),
    crowd: toB64(new Uint8Array(g.crowd.buffer, g.crowd.byteOffset, g.crowd.byteLength)),
  };
}

export function decodeGround(e: { size: number; wear: string; level: string; crowd: string }): Ground {
  return {
    size: e.size,
    wear: new Float32Array(fromB64(e.wear).buffer),
    level: fromB64(e.level),
    crowd: new Float32Array(fromB64(e.crowd).buffer),
  };
}
