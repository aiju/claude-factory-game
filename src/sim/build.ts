// Footprints, docks, placement validation and the spatial index.

import { BUILDINGS, type BuildingDef, type BuildingTypeId } from '../data/buildings';
import type { RawItemId } from '../data/items';
import { BUILD } from '../data/tunables';
import { aabb, corners, obbOverlap, toWorld, type OBB } from './geom';
import { reachabilityProblem } from './nav';
import { depositAt, heightAt } from './terrain';
import type { Building } from './types';
import type { Sim } from './world';

export function bodyOBB(def: BuildingDef, x: number, z: number, rot: number): OBB {
  return { cx: x, cz: z, hx: def.w / 2, hz: def.d / 2, rot };
}

export function dockOBB(def: BuildingDef, x: number, z: number, rot: number): OBB | null {
  if (!def.dock) return null;
  const [cx, cz] = toWorld(x, z, rot, 0, def.d / 2 + def.dock.d / 2);
  return { cx, cz, hx: def.dock.w / 2, hz: def.dock.d / 2, rot };
}

export function buildingBody(b: Building): OBB {
  return bodyOBB(BUILDINGS[b.type], b.x, b.z, b.rot);
}

export function buildingDock(b: Building): OBB | null {
  return dockOBB(BUILDINGS[b.type], b.x, b.z, b.rot);
}

/** How many spots a dock has for haulers to stop at. */
export function dockLanes(b: Building): number {
  const def = BUILDINGS[b.type];
  if (!def.dock) return 1;
  if (b.type === 'hub') return 5;
  // Lanes 1.8 m apart, so rovers can load side by side without touching.
  return Math.max(1, Math.floor(def.dock.w / 1.8));
}

/** Where a hauler stops to load or unload. `slot` spreads several haulers across a wide dock. */
export function dockPoint(b: Building, slot = 0): [number, number] {
  const def = BUILDINGS[b.type];
  if (!def.dock) return [b.x, b.z];
  if (b.type === 'hub') {
    const lanes = [0, -2.2, 2.2, -4.4, 4.4];
    return toWorld(b.x, b.z, b.rot, lanes[slot % lanes.length], def.d / 2 + 4.6);
  }
  const n = dockLanes(b);
  const lanes = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 1.8);
  return toWorld(b.x, b.z, b.rot, lanes[slot % lanes.length], def.d / 2 + def.dock.d * 0.55);
}

// ---------------------------------------------------------------------------
// Spatial index: a coarse hash of building ids by the cells their footprint
// (body + dock) touches. Derived; rebuilt from state on load.

const CELL = 16;

export interface SpatialIndex {
  cells: Map<number, number[]>;
}

export function createIndex(): SpatialIndex {
  return { cells: new Map() };
}

function keysFor(o: OBB, extra: OBB | null): number[] {
  const a = aabb(o);
  if (extra) {
    const e = aabb(extra);
    a.x0 = Math.min(a.x0, e.x0);
    a.z0 = Math.min(a.z0, e.z0);
    a.x1 = Math.max(a.x1, e.x1);
    a.z1 = Math.max(a.z1, e.z1);
  }
  const keys: number[] = [];
  for (let j = Math.floor(a.z0 / CELL); j <= Math.floor(a.z1 / CELL); j++)
    for (let i = Math.floor(a.x0 / CELL); i <= Math.floor(a.x1 / CELL); i++) keys.push((j + 64) * 1024 + (i + 64));
  return keys;
}

export function indexAdd(idx: SpatialIndex, b: Building) {
  for (const k of keysFor(buildingBody(b), buildingDock(b))) {
    let list = idx.cells.get(k);
    if (!list) idx.cells.set(k, (list = []));
    list.push(b.id);
  }
}

export function indexRemove(idx: SpatialIndex, b: Building) {
  for (const k of keysFor(buildingBody(b), buildingDock(b))) {
    const list = idx.cells.get(k);
    if (!list) continue;
    const i = list.indexOf(b.id);
    if (i >= 0) list.splice(i, 1);
  }
}

/** Building ids whose cells touch the given rectangles, ascending. */
export function queryIndex(idx: SpatialIndex, o: OBB, extra: OBB | null = null): number[] {
  const set = new Set<number>();
  for (const k of keysFor(o, extra)) for (const id of idx.cells.get(k) ?? []) set.add(id);
  return [...set].sort((a, b) => a - b);
}

export function buildingAt(sim: Sim, x: number, z: number): Building | null {
  const probe: OBB = { cx: x, cz: z, hx: 0.01, hz: 0.01, rot: 0 };
  for (const id of queryIndex(sim.d.index, probe)) {
    const b = sim.d.byId.get(id)!;
    if (obbOverlap(buildingBody(b), probe, 0)) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation

export interface PlacementOk {
  ok: true;
  y: number;
  extracts: RawItemId | null;
}
export interface PlacementBad {
  ok: false;
  reason: string;
}
export type Placement = PlacementOk | PlacementBad;

export function lowerName(b: Building): string {
  return 'the ' + BUILDINGS[b.type].name.toLowerCase();
}

/** Lowest and highest ground under a footprint, sampled on a small grid. */
export function footprintHeights(sim: Sim, type: BuildingTypeId, x: number, z: number, rot: number) {
  const def = BUILDINGS[type];
  let lo = Infinity;
  let hi = -Infinity;
  const steps = 4;
  for (let j = 0; j <= steps; j++) {
    for (let i = 0; i <= steps; i++) {
      const [wx, wz] = toWorld(x, z, rot, (i / steps - 0.5) * def.w, (j / steps - 0.5) * def.d);
      const h = heightAt(sim.d.terrain, wx, wz);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return { lo, hi };
}

/** Check a placement without changing anything. */
export function validatePlacement(sim: Sim, type: BuildingTypeId, x: number, z: number, rot: number): Placement {
  const def = BUILDINGS[type];
  const t = sim.d.terrain;
  const body = bodyOBB(def, x, z, rot);
  const dock = dockOBB(def, x, z, rot);

  const m = BUILD.edgeMargin;
  for (const [cx, cz] of [...corners(body), ...(dock ? corners(dock) : [])]) {
    if (cx < m || cz < m || cx > t.size - m || cz > t.size - m) return { ok: false, reason: 'Too close to the map edge.' };
  }

  const { lo, hi } = footprintHeights(sim, type, x, z, rot);
  if (hi - lo > def.maxUnevenness) return { ok: false, reason: 'Ground too uneven.' };

  let extracts: RawItemId | null = null;
  if (def.needsDeposit) {
    const k = depositAt(t, x, z);
    if (k < 0) return { ok: false, reason: 'Must sit on a deposit.' };
    extracts = sim.map.deposits[k].item;
  }

  for (const id of queryIndex(sim.d.index, body, dock)) {
    const o = sim.d.byId.get(id)!;
    const ob = buildingBody(o);
    const od = buildingDock(o);
    if (obbOverlap(body, ob)) return { ok: false, reason: `Overlaps ${lowerName(o)}.` };
    if (od && obbOverlap(body, od)) return { ok: false, reason: `Blocks ${lowerName(o)}'s dock.` };
    if (dock && obbOverlap(dock, ob)) return { ok: false, reason: `Dock is blocked by ${lowerName(o)}.` };
  }

  if (dock) {
    const probe = { id: -1, type, x, z, rot } as Building;
    const reach = reachabilityProblem(sim, type, x, z, rot, dockPoint(probe, 0));
    if (reach) return { ok: false, reason: reach };
  }

  return { ok: true, y: hi, extracts };
}
