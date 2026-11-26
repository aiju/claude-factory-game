// The hidden 1 m navigation grid: cliffs and footprints block cells, slope
// adds cost. A* with string-pulling gives straight-line paths.

import { BUILDINGS, type BuildingTypeId } from '../data/buildings';
import { NAV, PARKING, SCENERY } from '../data/tunables';
import { aabb, inflate, toLocal, toWorld, type OBB } from './geom';
import { bodyOBB, buildingBody, buildingDock, dockPoint, lowerName } from './build';
import { cellTravelCost, MIN_TRAVEL_COST, type Ground } from './ground';
import { cellSlope } from './terrain';
import type { Building } from './types';
import type { Sim } from './world';

export interface NavGrid {
  size: number;
  /** Cliffs and the map edge. */
  fixed: Uint8Array;
  /** Number of footprints covering each cell. */
  occ: Uint16Array;
  /** Cost multiplier per cell, ≥ 1. */
  cost: Float32Array;
  /** 4-connected component per free cell, -1 if blocked. Recomputed lazily. */
  comp: Int32Array;
  compDirty: boolean;
  /** Bumped on every change, so paths can be checked. */
  version: number;
}

export function createNav(sim: Sim): NavGrid {
  const t = sim.d.terrain;
  const n = t.size;
  const fixed = new Uint8Array(n * n);
  const cost = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const s = cellSlope(t, i, j);
      if (s > NAV.maxSlope || i === 0 || j === 0 || i === n - 1 || j === n - 1) fixed[k] = 1;
      cost[k] = 1 + s * NAV.slopeCost;
    }
  }
  const nav: NavGrid = { size: n, fixed, occ: new Uint16Array(n * n), cost, comp: new Int32Array(n * n), compDirty: true, version: 0 };
  const gone = new Set(sim.state.cleared);
  t.scenery.forEach((s, k) => {
    if (!gone.has(k)) stampDisc(nav, s.x, s.z, s.r, 1);
  });
  return nav;
}

/** Block (or free) the cells whose centres lie within a disc. */
function stampDisc(nav: NavGrid, x: number, z: number, r: number, delta: number) {
  const n = nav.size;
  const rr = r + 0.3;
  let any = false;
  for (let j = Math.max(0, Math.floor(z - rr)); j <= Math.min(n - 1, Math.floor(z + rr)); j++) {
    for (let i = Math.max(0, Math.floor(x - rr)); i <= Math.min(n - 1, Math.floor(x + rr)); i++) {
      if (Math.hypot(i + 0.5 - x, j + 0.5 - z) <= rr) {
        nav.occ[j * n + i] += delta;
        any = true;
      }
    }
  }
  // Always block at least the cell the thing stands in.
  if (!any) nav.occ[Math.floor(z) * n + Math.floor(x)] += delta;
  nav.compDirty = true;
  nav.version++;
}

/** Remove trees and boulders under and around a new building. */
export function clearScenery(sim: Sim, b: Building) {
  const body = inflate(buildingBody(b), SCENERY.buildMargin);
  const dock = buildingDock(b);
  const inside = (o: OBB, x: number, z: number, pad: number) => {
    const [lx, lz] = toLocal(o.cx, o.cz, o.rot, x, z);
    return Math.abs(lx) <= o.hx + pad && Math.abs(lz) <= o.hz + pad;
  };
  const gone = new Set(sim.state.cleared);
  sim.d.terrain.scenery.forEach((s, k) => {
    if (gone.has(k)) return;
    if (inside(body, s.x, s.z, s.r) || (dock && inside(dock, s.x, s.z, s.r + 0.5))) {
      sim.state.cleared.push(k);
      stampDisc(sim.d.nav, s.x, s.z, s.r, -1);
    }
  });
}

function rasterise(nav: NavGrid, o: OBB, delta: number) {
  const r = inflate(o, NAV.clearance);
  const a = aabb(r);
  const n = nav.size;
  for (let j = Math.max(0, Math.floor(a.z0)); j <= Math.min(n - 1, Math.floor(a.z1)); j++) {
    for (let i = Math.max(0, Math.floor(a.x0)); i <= Math.min(n - 1, Math.floor(a.x1)); i++) {
      const [lx, lz] = toLocal(r.cx, r.cz, r.rot, i + 0.5, j + 0.5);
      if (Math.abs(lx) <= r.hx && Math.abs(lz) <= r.hz) nav.occ[j * n + i] += delta;
    }
  }
  nav.compDirty = true;
  nav.version++;
}

export function navAddBuilding(sim: Sim, b: Building) {
  rasterise(sim.d.nav, buildingBody(b), 1);
  if (b.type === 'hub') stampParking(sim.d.nav, b, 1);
}

/** Through-traffic should not drive across the hub's parking rows: make them costly. */
function stampParking(nav: NavGrid, hub: Building, delta: number) {
  const def = BUILDINGS.hub;
  const P = PARKING;
  const halfRow = (P.front * P.spacing) / 2;
  const deep = P.rowZ + 0.9;
  const strips: OBB[] = [
    // Front row.
    { cx: 0, cz: def.d / 2 + deep / 2, hx: halfRow, hz: deep / 2, rot: 0 },
    // Sides.
    { cx: -(def.w / 2 + (P.sideX + 0.9) / 2), cz: 0, hx: (P.sideX + 0.9) / 2, hz: (P.side * P.spacing) / 2, rot: 0 },
    { cx: def.w / 2 + (P.sideX + 0.9) / 2, cz: 0, hx: (P.sideX + 0.9) / 2, hz: (P.side * P.spacing) / 2, rot: 0 },
    // Overflow rows behind.
    { cx: 0, cz: -(def.d / 2 + (deep + 2.6) / 2), hx: halfRow, hz: (deep + 2.6) / 2, rot: 0 },
  ];
  const n = nav.size;
  for (const st of strips) {
    const [cx, cz] = toWorld(hub.x, hub.z, hub.rot, st.cx, st.cz);
    const o: OBB = { cx, cz, hx: st.hx, hz: st.hz, rot: hub.rot };
    const a = aabb(o);
    for (let j = Math.max(0, Math.floor(a.z0)); j <= Math.min(n - 1, Math.floor(a.z1)); j++) {
      for (let i = Math.max(0, Math.floor(a.x0)); i <= Math.min(n - 1, Math.floor(a.x1)); i++) {
        const [lx, lz] = toLocal(o.cx, o.cz, o.rot, i + 0.5, j + 0.5);
        if (Math.abs(lx) <= o.hx && Math.abs(lz) <= o.hz) nav.cost[j * n + i] += delta * NAV.parkingCost;
      }
    }
  }
}

export function navRemoveBuilding(sim: Sim, b: Building) {
  rasterise(sim.d.nav, buildingBody(b), -1);
  if (b.type === 'hub') stampParking(sim.d.nav, b, -1);
}

export function blocked(nav: NavGrid, i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= nav.size || j >= nav.size) return true;
  const k = j * nav.size + i;
  return nav.fixed[k] !== 0 || nav.occ[k] !== 0;
}

export function blockedAt(nav: NavGrid, x: number, z: number): boolean {
  return blocked(nav, Math.floor(x), Math.floor(z));
}

/** Label 4-connected free regions into `out`. */
function label(nav: NavGrid, out: Int32Array) {
  const n = nav.size;
  out.fill(-1);
  const stack = new Int32Array(n * n);
  let c = 0;
  for (let k0 = 0; k0 < n * n; k0++) {
    if (out[k0] !== -1 || nav.fixed[k0] || nav.occ[k0]) continue;
    let sp = 0;
    stack[sp++] = k0;
    out[k0] = c;
    while (sp > 0) {
      const k = stack[--sp];
      const i = k % n;
      const j = (k - i) / n;
      const nbs = [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, j > 0 ? k - n : -1, j < n - 1 ? k + n : -1];
      for (const q of nbs) {
        if (q >= 0 && out[q] === -1 && !nav.fixed[q] && !nav.occ[q]) {
          out[q] = c;
          stack[sp++] = q;
        }
      }
    }
    c++;
  }
}

export function components(nav: NavGrid): Int32Array {
  if (nav.compDirty) {
    label(nav, nav.comp);
    nav.compDirty = false;
  }
  return nav.comp;
}

function cellOf(x: number, z: number): [number, number] {
  return [Math.floor(x), Math.floor(z)];
}

/** Nearest free cell to (i, j), searching outward a little. */
export function nearestFree(nav: NavGrid, i: number, j: number, maxR = 8): [number, number] | null {
  if (!blocked(nav, i, j)) return [i, j];
  for (let r = 1; r <= maxR; r++) {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (blocked(nav, i + di, j + dj)) continue;
        const d = di * di + dj * dj;
        if (d < bd) {
          bd = d;
          best = [i + di, j + dj];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** The cell a dock is served from. */
export function dockCell(nav: NavGrid, b: Building): [number, number] | null {
  const [x, z] = dockPoint(b, 0);
  const [i, j] = cellOf(x, z);
  return blocked(nav, i, j) ? null : [i, j];
}

/**
 * Would placing this footprint leave any dock (including its own) cut off
 * from the hub's? Returns a reason, or null if all is well.
 */
export function reachabilityProblem(sim: Sim, type: BuildingTypeId, x: number, z: number, rot: number, ownDock: [number, number]): string | null {
  const nav = sim.d.nav;
  const hub = sim.d.byId.get(sim.state.hub);
  if (!hub) return null;
  const body = bodyOBB(BUILDINGS[type], x, z, rot);
  rasterise(nav, body, 1);
  try {
    const comp = new Int32Array(nav.size * nav.size);
    label(nav, comp);
    const hc = dockCell(nav, hub);
    if (!hc) return 'Blocks the hub.';
    const home = comp[hc[1] * nav.size + hc[0]];
    const [oi, oj] = cellOf(ownDock[0], ownDock[1]);
    if (blocked(nav, oi, oj) || comp[oj * nav.size + oi] !== home) return 'Its dock cannot be reached from the hub.';
    for (const b of sim.state.buildings) {
      if (b === hub || !BUILDINGS[b.type].dock) continue;
      const c = dockCell(nav, b);
      if (!c || comp[c[1] * nav.size + c[0]] !== home) return `Cuts off ${lowerName(b)} from the hub.`;
    }
    return null;
  } finally {
    rasterise(nav, body, -1);
  }
}

// ---------------------------------------------------------------------------
// A*

class Heap {
  ids = new Int32Array(1024);
  keys = new Float64Array(1024);
  size = 0;
  push(id: number, key: number) {
    if (this.size === this.ids.length) {
      const ni = new Int32Array(this.size * 2);
      ni.set(this.ids);
      this.ids = ni;
      const nk = new Float64Array(this.size * 2);
      nk.set(this.keys);
      this.keys = nk;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.ids[i] = this.ids[p];
      this.keys[i] = this.keys[p];
      i = p;
    }
    this.ids[i] = id;
    this.keys[i] = key;
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size];
    const lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= lastKey) break;
      this.ids[i] = this.ids[c];
      this.keys[i] = this.keys[c];
      i = c;
    }
    this.ids[i] = lastId;
    this.keys[i] = lastKey;
    return top;
  }
}

interface Scratch {
  g: Float32Array;
  parent: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  gen: number;
  heap: Heap;
}
const scratchBySize = new Map<number, Scratch>();
function scratch(n: number): Scratch {
  let s = scratchBySize.get(n);
  if (!s) {
    s = { g: new Float32Array(n * n), parent: new Int32Array(n * n), seen: new Uint32Array(n * n), closed: new Uint32Array(n * n), gen: 0, heap: new Heap() };
    scratchBySize.set(n, s);
  }
  return s;
}

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Grid A*. Returns the cell list from start to goal, or null. */
/** Cost of a metre through cell k: ground speed and crowding, plus slope. */
function cellCost(nav: NavGrid, g: Ground | null, k: number): number {
  return (g ? cellTravelCost(g, k) : 1) + nav.cost[k] - 1;
}

export function astar(nav: NavGrid, si: number, sj: number, gi: number, gj: number, ground: Ground | null = null): number[] | null {
  const n = nav.size;
  const comp = components(nav);
  const sk = sj * n + si;
  const gk = gj * n + gi;
  if (comp[sk] < 0 || comp[sk] !== comp[gk]) return null;
  const s = scratch(n);
  s.gen++;
  if (s.gen === 0xffffffff) {
    s.seen.fill(0);
    s.closed.fill(0);
    s.gen = 1;
  }
  const gen = s.gen;
  const h = (k: number) => {
    const i = k % n;
    const j = (k - i) / n;
    const dx = Math.abs(i - gi);
    const dz = Math.abs(j - gj);
    return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * hScale;
  };
  const hScale = ground ? MIN_TRAVEL_COST : 1;
  s.heap.size = 0;
  s.g[sk] = 0;
  s.parent[sk] = -1;
  s.seen[sk] = gen;
  s.heap.push(sk, h(sk));
  while (s.heap.size > 0) {
    const k = s.heap.pop();
    if (s.closed[k] === gen) continue;
    s.closed[k] = gen;
    if (k === gk) break;
    const i = k % n;
    const j = (k - i) / n;
    for (const [di, dj, len] of DIRS) {
      const ni = i + di;
      const nj = j + dj;
      if (blocked(nav, ni, nj)) continue;
      // No corner cutting.
      if (di !== 0 && dj !== 0 && (blocked(nav, i + di, j) || blocked(nav, i, j + dj))) continue;
      const nk = nj * n + ni;
      if (s.closed[nk] === gen) continue;
      const g = s.g[k] + len * 0.5 * (cellCost(nav, ground, k) + cellCost(nav, ground, nk));
      if (s.seen[nk] !== gen || g < s.g[nk]) {
        s.seen[nk] = gen;
        s.g[nk] = g;
        s.parent[nk] = k;
        s.heap.push(nk, g + h(nk));
      }
    }
  }
  if (s.closed[gk] !== gen) return null;
  const cells: number[] = [];
  for (let k = gk; k !== -1; k = s.parent[k]) cells.push(k);
  cells.reverse();
  return cells;
}

/** Can a bot drive straight from a to b, keeping some clearance? */
export function lineClear(nav: NavGrid, ax: number, az: number, bx: number, bz: number, clearance = NAV.losClearance): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return !blockedAt(nav, ax, az);
  const px = (-dz / len) * clearance;
  const pz = (dx / len) * clearance;
  const steps = Math.ceil(len / 0.25);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = ax + dx * t;
    const z = az + dz * t;
    if (blockedAt(nav, x, z) || blockedAt(nav, x + px, z + pz) || blockedAt(nav, x - px, z - pz)) return false;
  }
  return true;
}

/** Mean cost along a straight line, for checking a shortcut doesn't climb a hill a detour avoided. */
function lineCost(nav: NavGrid, ground: Ground, ax: number, az: number, bx: number, bz: number): number {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  let c = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const i = Math.floor(ax + (bx - ax) * t);
    const j = Math.floor(az + (bz - az) * t);
    c += cellCost(nav, ground, j * nav.size + i);
  }
  return (c / (steps + 1)) * len;
}

/**
 * Path from (sx, sz) to (tx, tz) as flat [x, z, ...] waypoints, excluding the
 * start and ending exactly at the target. Null if unreachable.
 */
export function findPath(sim: Sim, sx: number, sz: number, tx: number, tz: number): number[] | null {
  const nav = sim.d.nav;
  const s = nearestFree(nav, Math.floor(sx), Math.floor(sz));
  const g = nearestFree(nav, Math.floor(tx), Math.floor(tz));
  if (!s || !g) return null;
  const ground = sim.state.ground;
  const cells = astar(nav, s[0], s[1], g[0], g[1], ground);
  if (!cells) return null;
  const n = nav.size;
  const pts: [number, number][] = cells.map((k) => [(k % n) + 0.5, Math.floor(k / n) + 0.5]);
  pts[0] = [sx, sz];
  if (!blockedAt(nav, tx, tz)) pts[pts.length - 1] = [tx, tz];
  else pts.push([tx, tz]);
  // String pulling: from each anchor, walk forward while the straight line
  // stays clear and is not much costlier than the cell path.
  const out: number[] = [];
  let a = 0;
  // Cumulative cell-path cost for comparison.
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + lineCost(nav, ground, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]));
  while (a < pts.length - 1) {
    let b = a + 1;
    const [ax, az] = pts[a];
    for (let k = a + 2; k < pts.length; k++) {
      const [bx, bz] = pts[k];
      if (!lineClear(nav, ax, az, bx, bz) || lineCost(nav, ground, ax, az, bx, bz) > (cum[k] - cum[a]) * 1.05 + 0.5) break;
      b = k;
    }
    out.push(pts[b][0], pts[b][1]);
    a = b;
  }
  // Already there: still a one-point path, so arrival is handled as usual.
  if (out.length === 0) out.push(tx, tz);
  return out;
}
