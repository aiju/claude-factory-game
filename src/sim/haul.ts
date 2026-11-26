// Haulers and the dispatcher. Everything that moves does so because of a
// request: inputs below target ask, outputs and the hub offer.

import { BUILDINGS } from '../data/buildings';
import type { ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { AVOID, DISPATCH, HAULER, PARKING, TICK_RATE, DT } from '../data/tunables';
import { dockLanes, dockPoint } from './build';
import type { CommandResult } from './commands';
import { angleDiff, obbOverlap, toWorld, type OBB } from './geom';
import { addWear, crowdFactor, groundSpeed } from './ground';
import { blockedAt, findPath, lineClear, pushOutOfBuildings, solidAt } from './nav';
import { pruneOutputs } from './prod';
import { heightAt } from './terrain';
import type { Building, Hauler, Job, Slot } from './types';
import type { Sim } from './world';

// ---------------------------------------------------------------------------
// Parking

/** Bay position and heading (facing out) for bay `k` at a hub. */
export function bayPose(hub: Building, k: number): { x: number; z: number; heading: number } {
  const def = BUILDINGS[hub.type];
  const P = PARKING;
  if (k < P.front) {
    const [x, z] = toWorld(hub.x, hub.z, hub.rot, (k - (P.front - 1) / 2) * P.spacing, def.d / 2 + P.rowZ);
    return { x, z, heading: hub.rot };
  }
  if (k < P.front + P.side * 2) {
    const j = k - P.front;
    const left = j < P.side;
    const lz = -((P.side - 1) / 2) * P.spacing + (j % P.side) * P.spacing;
    const lx = (left ? -1 : 1) * (def.w / 2 + P.sideX);
    const [x, z] = toWorld(hub.x, hub.z, hub.rot, lx, lz);
    return { x, z, heading: hub.rot + (left ? -Math.PI / 2 : Math.PI / 2) };
  }
  // Overflow: rows behind the hub, facing away from it.
  const j = k - P.front - P.side * 2;
  const row = Math.floor(j / P.front);
  const col = j % P.front;
  const [x, z] = toWorld(hub.x, hub.z, hub.rot, (col - (P.front - 1) / 2) * P.spacing, -(def.d / 2 + P.rowZ + row * 2.6));
  return { x, z, heading: hub.rot + Math.PI };
}

function forward(h: number): [number, number] {
  return [Math.sin(h), Math.cos(h)];
}

export function addHaulers(sim: Sim, n: number): CommandResult {
  const home = sim.d.byId.get(sim.state.hub);
  if (!home) return { ok: false, reason: 'There is no hub.' };
  for (let i = 0; i < n; i++) {
    const used = new Set(sim.state.haulers.filter((h) => h.home === home.id).map((h) => h.bay));
    let bay = 0;
    while (used.has(bay)) bay++;
    const p = bayPose(home, bay);
    sim.state.haulers.push({
      id: sim.state.nextId++,
      x: p.x,
      z: p.z,
      heading: p.heading,
      speed: 0,
      mode: 'idle',
      timer: 0,
      job: null,
      cargo: null,
      cargoN: 0,
      home: home.id,
      bay,
      path: [],
      pathI: 0,
      revFrom: -1,
      man: 'drive',
      manT: 0,
      mdir: 1,
      hold: 0,
      odo: 0,
      wait: 0,
      squeeze: 0,
      best: Infinity,
      bestT: 0,
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers

function jobById(sim: Sim, id: number | null): Job | undefined {
  return id === null ? undefined : sim.state.jobs.find((j) => j.id === id);
}

function haulerById(sim: Sim, id: number): Hauler | undefined {
  return sim.state.haulers.find((h) => h.id === id);
}

/** The slot a job takes from: an output buffer, or hub storage. */
function sourceSlot(b: Building, item: ItemId): Slot | undefined {
  return b.store ? b.store[item] : b.out[item];
}

/** The slot a job delivers to: an input buffer, or hub storage. */
function destSlot(b: Building, item: ItemId): Slot | undefined {
  return b.store ? b.store[item] : b.inp[item];
}

function isHub(b: Building) {
  return b.store !== null;
}

function setPath(sim: Sim, h: Hauler, tx: number, tz: number): boolean {
  const p = findPath(sim, h.x, h.z, tx, tz);
  h.pathI = 0;
  h.revFrom = -1;
  h.man = 'drive';
  h.manT = 0;
  h.best = Infinity;
  if (!p) {
    h.path = [];
    return false;
  }
  // The start is kept as waypoint 0, so the first leg has a segment to follow.
  h.path = [h.x, h.z, ...p];
  h.pathI = 1;
  return true;
}

/** The dock spot fewest other haulers are heading for (ties: the first). */
function pickLane(sim: Sim, h: Hauler, b: Building): [number, number] {
  const n = dockLanes(b);
  if (n === 1) return dockPoint(b, 0);
  const pts = Array.from({ length: n }, (_, i) => dockPoint(b, i));
  const use = new Array(n).fill(0);
  for (const o of sim.state.haulers) {
    if (o === h || o.path.length === 0 || o.mode === 'home') continue;
    const ex = o.path[o.path.length - 2];
    const ez = o.path[o.path.length - 1];
    pts.forEach(([x, z], i) => {
      if (Math.abs(ex - x) < 0.01 && Math.abs(ez - z) < 0.01) use[i]++;
    });
  }
  // Also count haulers standing at a spot (loading, unloading).
  for (const o of sim.state.haulers) {
    if (o === h || (o.mode !== 'loading' && o.mode !== 'unloading')) continue;
    pts.forEach(([x, z], i) => {
      if (Math.hypot(o.x - x, o.z - z) < 0.8) use[i]++;
    });
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (use[i] < use[best]) best = i;
  return pts[best];
}

function routeToDock(sim: Sim, h: Hauler, b: Building): boolean {
  const [x, z] = pickLane(sim, h, b);
  return setPath(sim, h, x, z);
}

function goHome(sim: Sim, h: Hauler) {
  h.job = null;
  const home = sim.d.byId.get(h.home);
  if (!home) {
    h.mode = 'idle';
    h.path = [];
    return;
  }
  const bay = bayPose(home, h.bay);
  if (Math.hypot(h.x - bay.x, h.z - bay.z) < 0.1) {
    h.mode = 'idle';
    h.path = [];
    return;
  }
  h.mode = 'home';
  if (!setParkPath(sim, h, bay) && !setPath(sim, h, bay.x, bay.z)) {
    // Can't get to the bay; wait where we are.
    h.mode = 'idle';
  }
}

/**
 * Park the way a driver would: run along in front of the row, stop just past
 * the bay, then reverse into it along a quarter circle. Picks the side that
 * is nearer. False if neither side has room.
 */
function setParkPath(sim: Sim, h: Hauler, bay: { x: number; z: number; heading: number }): boolean {
  const nav = sim.d.nav;
  const R = PARKING.approach;
  const [ox, oz] = forward(bay.heading);
  // Along the row: the bay's local x.
  const ax = Math.cos(bay.heading);
  const az = -Math.sin(bay.heading);
  const sides = [1, -1]
    .map((side) => {
      const sx = bay.x + ox * R + ax * side * R;
      const sz = bay.z + oz * R + az * side * R;
      const pre = { x: sx - ax * side * PARKING.runIn, z: sz - az * side * PARKING.runIn };
      return { side, sx, sz, pre, d: Math.hypot(pre.x - h.x, pre.z - h.z) };
    })
    .sort((a, b) => a.d - b.d);
  for (const o of sides) {
    if (!lineClear(nav, o.pre.x, o.pre.z, o.sx, o.sz, 0)) continue;
    // The arc from the stopping point back into the bay, centred beside the bay.
    const cx = bay.x + ax * o.side * R;
    const cz = bay.z + az * o.side * R;
    const arc: number[] = [];
    let ok = true;
    for (let k = 1; k <= 6; k++) {
      const phi = (Math.PI / 2) * (1 - k / 6);
      const x = cx - ax * o.side * R * Math.cos(phi) + ox * R * Math.sin(phi);
      const z = cz - az * o.side * R * Math.cos(phi) + oz * R * Math.sin(phi);
      if (blockedAt(nav, x, z)) ok = false;
      arc.push(x, z);
    }
    if (!ok) continue;
    const p = findPath(sim, h.x, h.z, o.pre.x, o.pre.z);
    if (!p) continue;
    const path = [h.x, h.z, ...p, o.sx, o.sz];
    h.revFrom = path.length / 2;
    path.push(...arc);
    h.path = path;
    h.pathI = 1;
    h.man = 'drive';
    h.manT = 0;
    h.best = Infinity;
    return true;
  }
  return false;
}

function endJob(sim: Sim, job: Job) {
  const i = sim.state.jobs.indexOf(job);
  if (i >= 0) sim.state.jobs.splice(i, 1);
}

/** Release everything a job holds. The hauler is left to the caller. */
function releaseJob(sim: Sim, job: Job) {
  const from = sim.d.byId.get(job.from);
  const to = sim.d.byId.get(job.to);
  if (!job.loaded && from) {
    const s = sourceSlot(from, job.item);
    if (s) s.r -= job.n;
    pruneOutputs(from);
  }
  if (to && !isHub(to)) {
    const s = destSlot(to, job.item);
    if (s) s.r -= job.n;
  }
}

/** Send a loaded hauler's cargo to the hub instead. */
function redirectToHub(sim: Sim, h: Hauler, job: Job) {
  const to = sim.d.byId.get(job.to);
  if (to && !isHub(to)) {
    const s = destSlot(to, job.item);
    if (s) s.r -= job.n;
  }
  job.to = sim.state.hub;
  h.mode = 'drop';
  const hub = sim.d.byId.get(sim.state.hub)!;
  if (!routeToDock(sim, h, hub)) {
    // Nowhere to go: put it away directly rather than lose it.
    hub.store![job.item]!.n += h.cargoN;
    h.cargo = null;
    h.cargoN = 0;
    endJob(sim, job);
    goHome(sim, h);
  }
}

/**
 * Cancel jobs that involve building `id`. With `inboundOnly`, only those
 * delivering to it (recipe change). Loaded haulers take their cargo to the hub.
 */
export function cancelJobsFor(sim: Sim, id: number, inboundOnly: boolean) {
  for (const job of [...sim.state.jobs]) {
    const inbound = job.to === id;
    const outbound = job.from === id && !inboundOnly;
    if (!inbound && !outbound) continue;
    const h = haulerById(sim, job.hauler)!;
    if (job.loaded) {
      if (inbound) redirectToHub(sim, h, job);
      // Outbound and already loaded: the source no longer matters.
      continue;
    }
    releaseJob(sim, job);
    endJob(sim, job);
    goHome(sim, h);
  }
}

/** Re-route haulers whose remaining path now runs through something new. */
export function repathBlocked(sim: Sim) {
  const nav = sim.d.nav;
  for (const h of sim.state.haulers) {
    if (h.path.length === 0) continue;
    let px = h.x;
    let pz = h.z;
    let bad = false;
    for (let k = h.pathI; k < h.path.length / 2; k++) {
      const x = h.path[k * 2];
      const z = h.path[k * 2 + 1];
      if (!lineClear(nav, px, pz, x, z, 0)) {
        bad = true;
        break;
      }
      px = x;
      pz = z;
    }
    if (!bad) continue;
    const job = jobById(sim, h.job);
    if (h.mode === 'home') goHome(sim, h);
    else if (job && (h.mode === 'pickup' || h.mode === 'drop')) {
      const target = sim.d.byId.get(h.mode === 'pickup' ? job.from : job.to);
      if (!target || !routeToDock(sim, h, target)) {
        if (h.mode === 'pickup') {
          releaseJob(sim, job);
          endJob(sim, job);
          goHome(sim, h);
        } else redirectToHub(sim, h, job);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatcher

interface Request {
  to: Building;
  item: ItemId;
  want: number;
  /** 0: consumers. 1: hub tidying. */
  cls: number;
  fill: number;
  since: number;
  starving: boolean;
  /** Hub tidying names its source. */
  from?: Building;
}

function freeHaulers(sim: Sim): Hauler[] {
  return sim.state.haulers.filter((h) => h.job === null && (h.mode === 'idle' || h.mode === 'home'));
}

function dist(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(ax - bx, az - bz);
}

function assign(sim: Sim, h: Hauler, from: Building, to: Building, item: ItemId, n: number): boolean {
  const job: Job = { id: sim.state.nextId++, hauler: h.id, item, n, from: from.id, to: to.id, loaded: false, created: sim.state.tick };
  const wasParked = h.mode === 'idle';
  if (!routeToDock(sim, h, from)) {
    sim.state.nextId--; // nothing happened
    return false;
  }
  sourceSlot(from, item)!.r += n;
  if (!isHub(to)) destSlot(to, item)!.r += n;
  sim.state.jobs.push(job);
  h.job = job.id;
  h.mode = 'pickup';
  if (wasParked) h.hold = Math.round(HAULER.pullOut * TICK_RATE);
  return true;
}

function collectRequests(sim: Sim): Request[] {
  const reqs: Request[] = [];
  const hub = sim.d.byId.get(sim.state.hub)!;
  for (const b of sim.state.buildings) {
    if (isHub(b) || !b.recipe) continue;
    const r = RECIPES[b.recipe];
    for (const [item, s] of Object.entries(b.inp) as [ItemId, Slot][]) {
      const perCraft = r.inputs[item] ?? 1;
      const have = s.n + s.r;
      const want = s.cap - have;
      const starving = have < perCraft;
      const asking = want > 0 && (starving || want >= Math.min(DISPATCH.minRequest, s.cap));
      if (!asking) {
        s.since = -1;
        continue;
      }
      if (s.since < 0) s.since = sim.state.tick;
      reqs.push({ to: b, item, want, cls: 0, fill: have / s.cap, since: s.since, starving });
    }
  }
  // The hub takes from a producer only when its tray is full, or when nothing
  // on the map consumes the item (end products, leftovers).
  const consumed = new Set<ItemId>();
  for (const b of sim.state.buildings) for (const item of Object.keys(b.inp) as ItemId[]) consumed.add(item);
  for (const b of sim.state.buildings) {
    if (isHub(b)) continue;
    for (const [item, s] of Object.entries(b.out) as [ItemId, Slot][]) {
      const avail = s.n - s.r;
      if (avail <= 0) continue;
      if (s.n >= s.cap || (!consumed.has(item) && avail >= DISPATCH.tidyMin)) {
        reqs.push({ to: hub, item, want: avail, cls: 1, fill: 0, since: sim.state.tick, starving: false, from: b });
      }
    }
  }
  reqs.sort((a, b) => a.cls - b.cls || a.fill - b.fill || a.since - b.since || a.to.id - b.to.id || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
  return reqs;
}

export function dispatch(sim: Sim) {
  let free = freeHaulers(sim);
  if (free.length === 0) return;
  const hub = sim.d.byId.get(sim.state.hub)!;
  const reqs = collectRequests(sim);
  for (const req of reqs) {
    if (free.length === 0) break;
    const [tx, tz] = dockPoint(req.to, 0);
    while (req.want > 0 && free.length > 0) {
      // Offers: producers first; the hub only if no producer has any.
      const offers: { b: Building; avail: number }[] = [];
      if (req.from) {
        const s = req.from.out[req.item];
        if (s && s.n - s.r > 0) offers.push({ b: req.from, avail: s.n - s.r });
      } else {
        const need = Math.min(req.want, HAULER.capacity);
        for (const b of sim.state.buildings) {
          if (isHub(b) || b === req.to) continue;
          const s = b.out[req.item];
          if (!s) continue;
          const avail = s.n - s.r;
          if (avail >= need || (avail > 0 && req.starving)) offers.push({ b, avail });
        }
        if (offers.length === 0) {
          const s = hub.store![req.item]!;
          if (s.n - s.r > 0) offers.push({ b: hub, avail: s.n - s.r });
        }
      }
      if (offers.length === 0) break;
      // Cheapest offer-and-hauler pair by straight-line trip estimate.
      let best: { o: (typeof offers)[0]; h: Hauler; cost: number } | null = null;
      for (const o of offers) {
        const [ox, oz] = dockPoint(o.b, 0);
        const leg2 = dist(ox, oz, tx, tz);
        for (const h of free) {
          const cost = dist(h.x, h.z, ox, oz) + leg2;
          if (!best || cost < best.cost - 1e-9) best = { o, h, cost };
        }
      }
      if (!best) break;
      const n = Math.min(req.want, best.o.avail, HAULER.capacity);
      const h = best.h;
      free = free.filter((f) => f !== h);
      if (assign(sim, h, best.o.b, req.to, req.item, n)) req.want -= n;
    }
  }
}

// ---------------------------------------------------------------------------
// Movement

/** The last waypoint index of the leg the hauler is on (a leg ends where it must stop and change direction). */
function legEnd(h: Hauler): number {
  const count = h.path.length / 2;
  return h.revFrom >= 0 && h.pathI < h.revFrom ? h.revFrom - 1 : count - 1;
}

/** Remaining length of the current leg from the hauler's position. */
export function remaining(h: Hauler): number {
  let d = 0;
  let px = h.x;
  let pz = h.z;
  const end = legEnd(h);
  for (let k = h.pathI; k <= end; k++) {
    const x = h.path[k * 2];
    const z = h.path[k * 2 + 1];
    d += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return d;
}

/** Plan the route to wherever the hauler is going again, keeping its progress clock. */
function replan(sim: Sim, h: Hauler) {
  const best = h.best;
  const bestT = h.bestT;
  const job = jobById(sim, h.job);
  if (h.mode === 'home') goHome(sim, h);
  else if (job && (h.mode === 'pickup' || h.mode === 'drop')) {
    const b = sim.d.byId.get(h.mode === 'pickup' ? job.from : job.to);
    if (b) routeToDock(sim, h, b);
  }
  h.best = best;
  h.bestT = bestT;
}

/** Remaining length of the whole path, all legs, from the hauler's position. */
function pathRemaining(h: Hauler): number {
  let d = 0;
  let px = h.x;
  let pz = h.z;
  for (let k = Math.max(1, h.pathI); k < h.path.length / 2; k++) {
    const x = h.path[k * 2];
    const z = h.path[k * 2 + 1];
    d += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return d;
}

/**
 * Pure-pursuit target: the nearest point on the segment being followed, then
 * `L` metres further along the path (clamped to the end of the leg).
 */
export function lookaheadPoint(h: Hauler, L: number): [number, number] {
  const end = legEnd(h);
  const i = Math.max(1, h.pathI);
  const ax = h.path[i * 2 - 2];
  const az = h.path[i * 2 - 1];
  const bx = h.path[i * 2];
  const bz = h.path[i * 2 + 1];
  const sx = bx - ax;
  const sz = bz - az;
  const s2 = sx * sx + sz * sz;
  const t = s2 > 1e-9 ? Math.max(0, Math.min(1, ((h.x - ax) * sx + (h.z - az) * sz) / s2)) : 1;
  let px = ax + sx * t;
  let pz = az + sz * t;
  let left = L;
  for (let k = i; k <= end; k++) {
    const x = h.path[k * 2];
    const z = h.path[k * 2 + 1];
    const seg = Math.hypot(x - px, z - pz);
    if (seg >= left) return [px + ((x - px) * left) / seg, pz + ((z - pz) * left) / seg];
    left -= seg;
    px = x;
    pz = z;
  }
  return [px, pz];
}

/** Would driving `dist` metres from here, curving at κ (1/m, + = left) in direction `dir`, hit anything? */
function arcBlocked(sim: Sim, h: Hauler, kappa: number, dir: number, dist: number): boolean {
  const nav = sim.d.nav;
  if (blockedAt(nav, h.x, h.z)) return false; // already inside a clearance zone: let it drive out
  let th = h.heading + (dir < 0 ? Math.PI : 0);
  let x = h.x;
  let z = h.z;
  const ds = 0.3;
  for (let s = ds; s <= dist + 1e-6; s += ds) {
    th += kappa * ds;
    x += Math.sin(th) * ds;
    z += Math.cos(th) * ds;
    if (blockedAt(nav, x, z)) return true;
  }
  return false;
}

/** Is (px, pz) inside one of the two circles the hauler cannot turn tighter than? */
function insideTurningCircle(h: Hauler, px: number, pz: number): boolean {
  const R = HAULER.minTurnRadius;
  // Left (heading-increasing) side is local +x: (cos h, -sin h).
  const lx = Math.cos(h.heading);
  const lz = -Math.sin(h.heading);
  for (const s of [1, -1]) {
    if (Math.hypot(px - (h.x + lx * s * R), pz - (h.z + lz * s * R)) < R * 0.95) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Local avoidance. Haulers see where everyone was at the start of the tick,
// so the result doesn't depend on update order.

interface Seen {
  id: number;
  x: number;
  z: number;
  /** Direction of travel (reversing flips it). */
  fx: number;
  fz: number;
  speed: number;
  /** Loading, unloading or pausing: will move on by itself. */
  busy: boolean;
  /** Parked in a bay: will not move until given a job. */
  parked: boolean;
  /** Where it is going (its final path point), or where it stands. */
  ex: number;
  ez: number;
}

interface Traffic {
  seen: Seen[];
  cells: Map<number, number[]>;
}

const TCELL = 4;

function buildTraffic(sim: Sim): Traffic {
  const seen: Seen[] = [];
  const cells = new Map<number, number[]>();
  for (const h of sim.state.haulers) {
    const rev = h.mdir < 0;
    const [fx, fz] = forward(h.heading);
    const busy = h.mode === 'loading' || h.mode === 'unloading' || h.hold > 0;
    const k = seen.length;
    const n = h.path.length;
    const ex = n ? h.path[n - 2] : h.x;
    const ez = n ? h.path[n - 1] : h.z;
    seen.push({ id: h.id, x: h.x, z: h.z, fx: rev ? -fx : fx, fz: rev ? -fz : fz, speed: h.speed, busy, parked: h.mode === 'idle', ex, ez });
    const key = Math.floor(h.x / TCELL) * 1024 + Math.floor(h.z / TCELL);
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(k);
  }
  return { seen, cells };
}

function* near(tr: Traffic, x: number, z: number, r: number): Generator<Seen> {
  const i0 = Math.floor((x - r) / TCELL);
  const i1 = Math.floor((x + r) / TCELL);
  const j0 = Math.floor((z - r) / TCELL);
  const j1 = Math.floor((z + r) / TCELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const list = tr.cells.get(i * 1024 + j);
      if (list) for (const k of list) yield tr.seen[k];
    }
  }
}

/**
 * How other haulers constrain this one: a speed cap (following, queueing,
 * yielding) and a steering offset (keep right, pass a stopped bot). Positive
 * steer turns left.
 */
function avoidance(h: Hauler, tr: Traffic, fx: number, fz: number, endX: number, endZ: number, parking: boolean): { cap: number; steer: number; heldBy: number; queued: boolean } {
  const R = AVOID.radius;
  const look = AVOID.look + h.speed * AVOID.lookPerSpeed;
  // Right-hand side of the direction of travel.
  const rx = -fz;
  const rz = fx;
  let cap = Infinity;
  let steer = 0;
  let heldBy = -1;
  /** The tightest limit comes from waiting in line for a dock spot. */
  let queued = false;
  const impatient = h.squeeze > 0;
  const limit = (v: number, o: Seen, patient = false) => {
    // Deadlock breaker: a bot that has made no progress for a while squeezes
    // past others on the move. Bots that are loading will clear by
    // themselves, and dock queues keep their order, so those still count.
    if (impatient && !patient) return;
    if (v < cap) {
      cap = v;
      heldBy = o.id;
      queued = patient;
    }
  };
  for (const o of near(tr, h.x, h.z, look + 2 * R)) {
    if (o.id === h.id) continue;
    // Reversing into a bay is a precise manoeuvre past parked neighbours.
    if (parking && o.parked) continue;
    const dx = o.x - h.x;
    const dz = o.z - h.z;
    // Bound for the same spot (one dock lane): whoever is nearer goes first,
    // the other holds back. A bot already working there is nearest.
    const myD = Math.hypot(h.x - endX, h.z - endZ);
    // (Queueing only applies close to the spot; further out it is just traffic.)
    if (!o.parked && myD < AVOID.queueZone && (Math.hypot(o.ex - endX, o.ez - endZ) < 0.5 || (o.busy && Math.hypot(o.x - endX, o.z - endZ) < 1))) {
      const oD = o.busy ? 0 : Math.hypot(o.x - endX, o.z - endZ);
      if (oD < myD - 1e-6 || (Math.abs(oD - myD) <= 1e-6 && o.id < h.id)) {
        if (o.busy) {
          // Someone is working there: wait well back, so they can back out and turn.
          limit(Math.max(0, myD - AVOID.queueStandoff) * 1.5, o, true);
        } else {
          const d = Math.hypot(dx, dz);
          if (d < 2 * R + AVOID.gap + 1.5) limit(Math.max(0, d - 2 * R - AVOID.gap) * 1.5, o, true);
        }
      }
      continue;
    }
    const ahead = dx * fx + dz * fz;
    if (ahead <= 0 || ahead > look + 2 * R) continue;
    const side = dx * rx + dz * rz;
    const gapEdge = ahead - 2 * R;
    const same = fx * o.fx + fz * o.fz;
    const moving = o.speed > 0.3 && !o.busy;
    if (Math.abs(side) > 2 * R * 1.4) continue;
    const inLane = Math.abs(side) < 2 * R * 0.95;
    if (moving && same > 0.5) {
      // Following: match its speed, keep a gap.
      if (inLane) limit(o.speed + Math.max(0, gapEdge - AVOID.gap) * 1.2, o);
    } else if (!moving) {
      const oEnd = Math.hypot(endX - o.x, endZ - o.z);
      if (!o.parked && oEnd < 2.6 && oEnd < Math.hypot(endX - h.x, endZ - h.z)) {
        // Waiting for the same spot: queue behind it.
        if (inLane) limit(Math.max(0, gapEdge - AVOID.gap) * 1.5, o, o.busy);
      } else {
        // Something stopped in the way: go round it.
        const s = Math.max(0, 1 - Math.abs(side) / (2 * R * 1.4)) * Math.max(0, 1 - gapEdge / look);
        steer += (side > 0 ? 1 : -1) * s * AVOID.maxSteer;
        if (inLane) limit(1 + Math.max(0, gapEdge) * 0.8, o, o.busy);
      }
    } else if (same < -0.5) {
      // Oncoming: both keep right.
      const s = Math.max(0, 1 - gapEdge / look);
      steer -= s * AVOID.maxSteer;
      if (inLane && gapEdge < 1.5) limit(Math.max(0, gapEdge - AVOID.gap) * 0.8, o);
    } else if (inLane && (side > 0.2 || (side >= -0.2 && o.id < h.id))) {
      // Crossing: give way to the bot on the right.
      limit(Math.max(0, gapEdge - AVOID.gap) * 1.2, o);
    }
  }
  steer = Math.max(-AVOID.maxSteer, Math.min(AVOID.maxSteer, steer));
  return { cap, steer, heldBy, queued };
}

/** Nudge apart haulers that overlap, without pushing anyone into a wall. */
function separate(sim: Sim, h: Hauler, tr: Traffic) {
  const R = AVOID.radius * 0.85;
  let px = 0;
  let pz = 0;
  for (const o of near(tr, h.x, h.z, 2 * R)) {
    if (o.id === h.id) continue;
    const dx = h.x - o.x;
    const dz = h.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d >= 2 * R) continue;
    const push = (2 * R - d) * (h.squeeze > 0 ? 0.05 : 0.25);
    if (d < 1e-4) {
      // Exactly on top of each other: split by id.
      px += (h.id < o.id ? 1 : -1) * push;
    } else {
      px += (dx / d) * push;
      pz += (dz / d) * push;
    }
  }
  if ((px || pz) && !solidAt(sim, h.x + px, h.z + pz) && (h.squeeze > 0 || !bumpsInto(h, h.x + px, h.z + pz, tr))) {
    h.x += px;
    h.z += pz;
  }
}

/**
 * Advance along the path like a wheeled vehicle: heading only changes while
 * moving, never tighter than the minimum turning radius. Paths are followed by
 * pure pursuit. When the way on is inside the turning circle, or turning would
 * run into something, the hauler backs up to turn (a shunt); only when it is
 * boxed in both ways does it turn on the spot. Returns true on arrival.
 */
function drive(sim: Sim, h: Hauler, tr: Traffic): boolean {
  if (h.hold > 0) {
    h.hold--;
    return false;
  }
  const count = h.path.length / 2;
  if (h.pathI >= count) {
    h.speed = 0;
    return true;
  }
  if (h.pathI < 1) h.pathI = 1;
  // Advance past intermediate waypoints once passed (or nearly reached); the
  // end of a leg must be reached properly (it is where the hauler stops to
  // change direction).
  let end = legEnd(h);
  while (h.pathI < end) {
    const ax = h.path[h.pathI * 2 - 2];
    const az = h.path[h.pathI * 2 - 1];
    const bx = h.path[h.pathI * 2];
    const bz = h.path[h.pathI * 2 + 1];
    const passed = (h.x - bx) * (bx - ax) + (h.z - bz) * (bz - az) >= 0;
    if (!passed && Math.hypot(bx - h.x, bz - h.z) > 0.6) break;
    h.pathI++;
  }
  const reverseLeg = h.revFrom >= 0 && h.pathI >= h.revFrom;
  const ex = h.path[end * 2];
  const ez = h.path[end * 2 + 1];
  const dEnd = Math.hypot(ex - h.x, ez - h.z);
  const final = end === count - 1;
  const tight = reverseLeg ? 0.15 : 0.3;
  // Close to a dock spot it cannot drive any closer to (inside its turning
  // circle): near enough to load from.
  const closeEnough = !reverseLeg && final && dEnd < 0.9 && insideTurningCircle(h, ex, ez);
  if (dEnd < tight || closeEnough || (dEnd < 0.7 && h.speed < 0.05 && (h.wait > 15 || h.man !== 'drive'))) {
    if (final && h.speed > 0.6 && closeEnough && dEnd >= tight) {
      // Brake to a stop first.
      h.speed = Math.max(0, h.speed - HAULER.decel * 1.6 * DT);
      return false;
    }
    if (final) {
      h.speed = 0;
      h.path = [];
      h.pathI = 0;
      h.revFrom = -1;
      h.wait = 0;
      h.man = 'drive';
      h.mdir = 1;
      return true;
    }
    // End of a forward leg: stop, then start the reversing leg.
    if (h.speed > 0.1) {
      h.speed = Math.max(0, h.speed - HAULER.decel * 1.6 * DT);
    } else {
      h.pathI = end + 1;
      end = legEnd(h);
    }
  }

  const g = sim.state.ground;
  const t = sim.d.terrain;
  const Rmin = HAULER.minTurnRadius;
  const kMax = 1 / Rmin;
  const endX = h.path[count * 2 - 2];
  const endZ = h.path[count * 2 - 1];
  const L = reverseLeg ? 1.0 : HAULER.lookahead + HAULER.lookaheadPerSpeed * h.speed;
  const [px, pz] = lookaheadPoint(h, L);
  const toP = Math.atan2(px - h.x, pz - h.z);
  const aFwd = angleDiff(toP, h.heading);
  h.manT++;

  // Decide the manoeuvre. Reversing legs (parking) are simply driven backwards.
  let dir = reverseLeg ? -1 : 1;
  let kappa = 0;
  let wantSpeed = 0;
  if (!reverseLeg) {
    if (h.man === 'drive') {
      const ld = Math.max(0.3, Math.hypot(px - h.x, pz - h.z));
      let k = Math.abs(aFwd) > Math.PI / 2 ? Math.sign(aFwd) * kMax : (2 * Math.sin(aFwd)) / ld;
      k = Math.max(-kMax, Math.min(kMax, k));
      // Behind and too close to swing round to, or a wall in the way of the
      // turn: back up and try again. Anything else is driven, on full lock
      // if need be.
      const behindTight = Math.abs(aFwd) > Math.PI / 2 && insideTurningCircle(h, px, pz) && ld > 0.4;
      const ahead = arcBlocked(sim, h, k, 1, 1.2) && !lineClear(sim.d.nav, h.x, h.z, px, pz, 0);
      // Pressed against something solid (a wide swing, say).
      const wall = h.speed < 0.1 && h.wait > 15 && solidAt(sim, h.x + Math.sin(h.heading) * 0.3, h.z + Math.cos(h.heading) * 0.3);
      if ((behindTight || ahead || wall) && h.manT > 10) {
        // Back up if there is room; turn on the spot only when walled in.
        // With another hauler right behind, a tight target is driven round
        // the long way instead.
        const backK = Math.sign(aFwd || 1) * kMax;
        const wallBehind = arcBlocked(sim, h, backK, -1, 1.0);
        if (!wallBehind && !haulerBehind(h, tr)) h.man = 'shunt';
        else if (ahead || wall || wallBehind) h.man = ahead || wall ? 'pivot' : 'drive';
        h.manT = 0;
      }
    } else if (h.man === 'shunt') {
      const backK = Math.sign(aFwd || 1) * kMax;
      const fwdK = Math.max(-kMax, Math.min(kMax, Math.abs(aFwd) > Math.PI / 2 ? Math.sign(aFwd) * kMax : 2 * Math.sin(aFwd) / Math.max(0.3, L)));
      const clear =
        Math.abs(aFwd) < (75 * Math.PI) / 180 &&
        (!arcBlocked(sim, h, fwdK, 1, 1.2) || lineClear(sim.d.nav, h.x, h.z, px, pz, 0));
      if ((clear && h.manT > 0.6 * TICK_RATE) || h.manT > HAULER.shuntMax * TICK_RATE) {
        h.man = 'drive';
        h.manT = 0;
      } else if (arcBlocked(sim, h, backK, -1, 0.6)) {
        h.man = 'pivot';
        h.manT = 0;
      } else if (haulerBehind(h, tr)) {
        h.man = 'drive';
        h.manT = 0;
      }
    } else if (h.man === 'pivot') {
      if (Math.abs(aFwd) < 0.5 || h.manT > 4 * TICK_RATE) {
        h.man = 'drive';
        h.manT = 0;
      }
    }
  }

  // Direction changes need a stop first.
  const wantDir = h.man === 'shunt' || reverseLeg ? -1 : 1;
  if (wantDir !== h.mdir && h.speed > 0.05) {
    dir = h.mdir;
    wantSpeed = 0;
    kappa = 0;
  } else {
    h.mdir = wantDir;
    dir = wantDir;
  }

  const [hx, hz] = forward(h.heading);
  const av = avoidance(h, tr, hx * dir, hz * dir, endX, endZ, reverseLeg);
  const top = (dir < 0 ? HAULER.reverseSpeed : HAULER.speed) * groundSpeed(g, h.x, h.z) * crowdFactor(g, h.x, h.z);
  const climb = (heightAt(t, h.x + hx * 0.6 * dir, h.z + hz * 0.6 * dir) - heightAt(t, h.x, h.z)) / 0.6;

  if (h.man === 'pivot' && !reverseLeg) {
    // Boxed in: stop and turn on the spot towards the way on.
    h.speed = Math.max(0, h.speed - HAULER.decel * 1.6 * DT);
    if (h.speed < 0.05) {
      const turn = HAULER.pivotRate * DT;
      const next = h.heading + Math.max(-turn, Math.min(turn, aFwd));
      if (h.squeeze > 0 || !bumpsInto(h, h.x, h.z, tr, next)) h.heading = next;
      else h.wait++;
    }
  } else if (wantDir === h.mdir) {
    if (h.man === 'shunt' && !reverseLeg) {
      // Back up with opposite lock, swinging the nose round.
      kappa = Math.sign(aFwd || 1) * kMax;
      wantSpeed = HAULER.shuntSpeed;
    } else {
      // Pure pursuit, in whichever direction this leg is driven.
      const thM = h.heading + (dir < 0 ? Math.PI : 0);
      let a = angleDiff(toP, thM);
      if (dir > 0) a += av.steer;
      const ld = Math.max(0.3, Math.hypot(px - h.x, pz - h.z));
      const kNeed = Math.abs(a) > Math.PI / 2 ? Math.sign(a) * kMax * 2 : (2 * Math.sin(a)) / ld;
      kappa = Math.max(-kMax, Math.min(kMax, kNeed));
      wantSpeed = top / (1 + HAULER.climbPenalty * Math.max(0, climb));
      // Slow for curves: sideways acceleration, and more when the path wants
      // tighter than the vehicle can turn.
      wantSpeed = Math.min(wantSpeed, Math.sqrt(HAULER.lateralAccel / Math.max(1e-3, Math.abs(kNeed))));
      if (Math.abs(kNeed) > kMax) wantSpeed = Math.min(wantSpeed, HAULER.tightBendSpeed);
      // Corners further along.
      if (h.pathI < end) {
        const tx = h.path[h.pathI * 2];
        const tz = h.path[h.pathI * 2 + 1];
        const nx = h.path[h.pathI * 2 + 2] - tx;
        const nz = h.path[h.pathI * 2 + 3] - tz;
        const turn = Math.abs(angleDiff(Math.atan2(nx, nz), Math.atan2(tx - h.x, tz - h.z)));
        const vc = top * Math.max(0.3, 1 - turn / Math.PI);
        wantSpeed = Math.min(wantSpeed, Math.sqrt(vc * vc + 2 * HAULER.decel * Math.max(0, Math.hypot(tx - h.x, tz - h.z) - 1.0)));
      }
    }
    // Stop in time at the end of the leg.
    wantSpeed = Math.min(wantSpeed, Math.sqrt(2 * HAULER.decel * remaining(h)) + 0.05);
  }

  const free = wantSpeed;
  const v = Math.min(wantSpeed, av.cap);
  // Count time spent getting nowhere; past the limit, squeeze through.
  if (h.squeeze > 0) {
    h.squeeze--;
    // Finish squeezing past before becoming solid again.
    if (h.squeeze === 0 && touchingAny(h, tr)) h.squeeze = 1;
  }
  if (h.speed < 0.3 && av.cap < free) h.wait++;
  else if (h.speed > 0.6) h.wait = 0;
  // The guarantee against deadlock: no metre of headway towards the end of
  // the path in a long while, whatever it has tried, and it squeezes past.
  const toEnd = pathRemaining(h);
  // Waiting in line for a dock is not a deadlock.
  if (av.queued && av.cap < 0.3) h.bestT = sim.state.tick;
  if (toEnd < h.best - 1) {
    h.best = toEnd;
    h.bestT = sim.state.tick;
  } else if (h.squeeze === 0) {
    const stuck = sim.state.tick - h.bestT;
    const P = Math.round(AVOID.patience * TICK_RATE);
    if (stuck === P && !reverseLeg) {
      // First: back right off and plan the way in again (perhaps by the other
      // lane); or, if it has been going round in circles, turn on the spot.
      const back = Math.sign(aFwd || 1) / HAULER.minTurnRadius;
      if (h.wait > 0 && !arcBlocked(sim, h, back, -1, 2) && !haulerBehind(h, tr)) {
        replan(sim, h);
        h.man = 'shunt';
        h.manT = -Math.round(1.5 * TICK_RATE);
      } else if (h.wait === 0) {
        h.man = 'pivot';
        h.manT = 0;
      }
    } else if (stuck > 2 * P) {
      // Still held up by other haulers after all that: squeeze past.
      h.bestT = sim.state.tick;
      if (h.wait > 0) h.squeeze = Math.round(AVOID.squeeze * TICK_RATE);
    }
  }
  if (h.man !== 'pivot' || reverseLeg) {
    if (h.speed < v) h.speed = Math.min(v, h.speed + HAULER.accel * DT);
    else h.speed = Math.max(v, h.speed - HAULER.decel * 1.6 * DT);
  }
  const step = h.speed * DT;
  if (step <= 0) {
    maybeBackOff(sim, h, tr, av.heldBy, aFwd, reverseLeg);
    return false;
  }
  // Heading follows the curvature of the ground covered.
  const h0 = h.heading;
  const [fx, fz] = forward(h0 + kappa * step);
  let nx = h.x + fx * step * dir;
  let nz = h.z + fz * step * dir;
  // Don't dodge others into the clearance round buildings: if a dodge would,
  // take the step straight at the path instead.
  const nav = sim.d.nav;
  if (av.steer !== 0 && dir > 0 && blockedAt(nav, nx, nz) && !blockedAt(nav, h.x, h.z)) {
    const d = Math.max(1e-6, Math.hypot(px - h.x, pz - h.z));
    nx = h.x + ((px - h.x) / d) * step;
    nz = h.z + ((pz - h.z) / d) * step;
  }
  // Buildings, trees and cliffs are solid: slide along them, or stop.
  if (solidAt(sim, nx, nz) && !solidAt(sim, h.x, h.z)) {
    [nx, nz] = pushOutOfBuildings(sim, nx, nz);
    if (solidAt(sim, nx, nz)) {
      if (!solidAt(sim, nx, h.z)) nz = h.z;
      else if (!solidAt(sim, h.x, nz)) nx = h.x;
      else {
        nx = h.x;
        nz = h.z;
      }
    }
  }
  // So are other haulers, except as the very last way out of a deadlock.
  let bumped = 0;
  if (h.squeeze === 0 && (nx !== h.x || nz !== h.z)) bumped = bumpsInto(h, nx, nz, tr, h0 + kappa * step);
  if (bumped) {
    nx = h.x;
    nz = h.z;
  }
  const moved = Math.hypot(nx - h.x, nz - h.z);
  if (moved < step * 0.3) {
    // Held up by something solid: stop, and count it as waiting.
    h.speed = 0;
    h.wait++;
  }
  h.heading = h0 + kappa * Math.min(moved, step);
  maybeBackOff(sim, h, tr, av.heldBy > 0 ? av.heldBy : bumped, aFwd, reverseLeg);

  h.x = nx;
  h.z = nz;
  h.odo += moved;
  if (moved > 0) addWear(g, h.x, h.z, moved);
  return false;
}

/**
 * Stuck behind another hauler for a while: back off a little, if there is room
 * behind, and try again.
 */
function maybeBackOff(sim: Sim, h: Hauler, tr: Traffic, blocker: number, aFwd: number, reverseLeg: boolean) {
  if (reverseLeg || h.man !== 'drive' || blocker <= 0) return;
  const o = tr.seen.find((x) => x.id === blocker);
  if (!o) return;
  // Something standing still (loading, parked, queued) won't clear the way:
  // back off and come at it again soon. Two bots blocking each other on the
  // move: the higher number gives way, after a little longer.
  const still = o.busy || o.parked || o.speed < 0.1;
  const after = still ? AVOID.backOffStill : AVOID.backOff;
  if (h.wait < Math.round(after * TICK_RATE)) return;
  if (!still && !(blocker < h.id)) return;
  const back = Math.sign(aFwd || 1) / HAULER.minTurnRadius;
  if (arcBlocked(sim, h, back, -1, 1.2) || haulerBehind(h, tr)) return;
  h.man = 'shunt';
  h.manT = -Math.round(0.8 * TICK_RATE); // a proper back-off, not a twitch
  h.wait = 0;
}

/** A hauler's outline at a position and heading. */
function outline(x: number, z: number, heading: number, grow = 0): OBB {
  return { cx: x, cz: z, hx: AVOID.halfWidth + grow, hz: AVOID.halfLength + grow, rot: heading };
}

/**
 * Would moving to (nx, nz) put this hauler's outline into another's? Moving
 * apart from one it already touches is always allowed. Its id, or 0.
 */
function bumpsInto(h: Hauler, nx: number, nz: number, tr: Traffic, heading = h.heading): number {
  const mine = outline(nx, nz, heading, 0.02);
  for (const o of near(tr, nx, nz, 2.6)) {
    if (o.id === h.id) continue;
    const rot = Math.atan2(o.fx, o.fz);
    // Where it was at the start of the tick, and where it is heading this tick.
    const step = o.speed * DT;
    const hitNow = obbOverlap(mine, outline(o.x, o.z, rot), 0);
    const hitNext = step > 0 && obbOverlap(mine, outline(o.x + o.fx * step, o.z + o.fz * step, rot), 0);
    if (!hitNow && !hitNext) continue;
    const was = obbOverlap(outline(h.x, h.z, h.heading, 0.02), outline(o.x, o.z, rot), 0);
    // Already touching: only moves that open the gap are allowed.
    if (!was || Math.hypot(o.x - nx, o.z - nz) < Math.hypot(o.x - h.x, o.z - h.z) + 1e-4) return o.id;
  }
  return 0;
}

/** Is this hauler's outline touching any other's right now? */
function touchingAny(h: Hauler, tr: Traffic): boolean {
  const mine = outline(h.x, h.z, h.heading);
  for (const o of near(tr, h.x, h.z, 2.6)) {
    if (o.id !== h.id && obbOverlap(mine, outline(o.x, o.z, Math.atan2(o.fx, o.fz)), 0)) return true;
  }
  return false;
}

/** Another hauler close behind (so backing up is not an option). */
function haulerBehind(h: Hauler, tr: Traffic): boolean {
  const [fx, fz] = forward(h.heading);
  for (const o of near(tr, h.x, h.z, 3)) {
    if (o.id === h.id) continue;
    const dx = o.x - h.x;
    const dz = o.z - h.z;
    const back = -(dx * fx + dz * fz);
    const side = Math.abs(dx * fz - dz * fx);
    if (back > 0 && back < 2 * AVOID.radius + 0.8 && side < 2 * AVOID.radius) return true;
  }
  return false;
}

function onArrive(sim: Sim, h: Hauler) {
  const job = jobById(sim, h.job);
  switch (h.mode) {
    case 'home': {
      h.mode = 'idle';
      // Settle square in the bay if it came in close to straight.
      const home = sim.d.byId.get(h.home);
      if (home) {
        const want = bayPose(home, h.bay).heading;
        if (Math.abs(angleDiff(want, h.heading)) < 0.35) h.heading = want;
      }
      break;
    }
    case 'pickup':
      h.mode = 'loading';
      h.timer = Math.round(HAULER.loadTime * TICK_RATE);
      break;
    case 'drop':
      h.mode = 'unloading';
      h.timer = Math.round(HAULER.unloadTime * TICK_RATE);
      break;
    default:
      if (!job) h.mode = 'idle';
  }
}

function finishLoading(sim: Sim, h: Hauler, job: Job) {
  const from = sim.d.byId.get(job.from);
  const to = sim.d.byId.get(job.to);
  const s = from ? sourceSlot(from, job.item) : undefined;
  const take = s ? Math.min(job.n, s.n) : 0;
  if (s) {
    s.n -= take;
    s.r -= job.n;
    pruneOutputs(from!);
  }
  if (take < job.n && to && !isHub(to)) destSlot(to, job.item)!.r -= job.n - take;
  job.n = take;
  if (take === 0) {
    endJob(sim, job);
    goHome(sim, h);
    return;
  }
  job.loaded = true;
  h.cargo = job.item;
  h.cargoN = take;
  h.mode = 'drop';
  h.hold = Math.round(HAULER.pullOut * TICK_RATE);
  if (!to || !routeToDock(sim, h, to)) redirectToHub(sim, h, job);
}

function finishUnloading(sim: Sim, h: Hauler, job: Job) {
  const to = sim.d.byId.get(job.to);
  const hub = sim.d.byId.get(sim.state.hub)!;
  if (to) {
    const s = destSlot(to, job.item);
    if (s) {
      s.n += h.cargoN;
      if (!isHub(to)) s.r -= job.n;
    } else {
      // No longer wanted here (should not happen: recipe changes cancel inbound jobs).
      hub.store![job.item]!.n += h.cargoN;
    }
  } else hub.store![job.item]!.n += h.cargoN;
  h.cargo = null;
  h.cargoN = 0;
  endJob(sim, job);
  h.hold = Math.round(HAULER.pullOut * TICK_RATE);
  goHome(sim, h);
}

export function tickHaulers(sim: Sim) {
  if (sim.state.tick % DISPATCH.interval === 0) dispatch(sim);
  const tr = buildTraffic(sim);
  for (const h of sim.state.haulers) {
    switch (h.mode) {
      case 'idle':
        h.speed = 0;
        break;
      case 'loading':
      case 'unloading': {
        h.speed = 0;
        if (--h.timer > 0) break;
        const job = jobById(sim, h.job);
        if (!job) goHome(sim, h);
        else if (h.mode === 'loading') finishLoading(sim, h, job);
        else finishUnloading(sim, h, job);
        break;
      }
      default:
        if (h.path.length === 0) {
          // Lost its route (e.g. it was blocked in); try again now and then.
          if (sim.state.tick % 30 === h.id % 30) {
            const job = jobById(sim, h.job);
            if (h.mode === 'home') goHome(sim, h);
            else if (job) {
              const b = sim.d.byId.get(h.mode === 'pickup' ? job.from : job.to);
              if (b) routeToDock(sim, h, b);
            }
          }
          break;
        }
        if (drive(sim, h, tr)) onArrive(sim, h);
        else separate(sim, h, tr);
    }
  }
}

// ---------------------------------------------------------------------------
// Checks (tests and debugging)

/** Compare every slot's reservation with what the live jobs account for. */
export function checkReservations(sim: Sim): string[] {
  const expect = new Map<string, number>();
  const add = (id: number, side: string, item: ItemId, n: number) => {
    const k = `${id}:${side}:${item}`;
    expect.set(k, (expect.get(k) ?? 0) + n);
  };
  for (const j of sim.state.jobs) {
    const from = sim.d.byId.get(j.from);
    const to = sim.d.byId.get(j.to);
    if (!j.loaded && from) add(j.from, from.store ? 'store' : 'out', j.item, j.n);
    if (to && !to.store) add(j.to, 'inp', j.item, j.n);
    const h = haulerById(sim, j.hauler);
    if (!h || h.job !== j.id) expect.set(`job ${j.id} hauler mismatch`, -1);
  }
  const problems: string[] = [];
  for (const b of sim.state.buildings) {
    for (const [side, slots] of [['inp', b.inp], ['out', b.out], ['store', b.store ?? {}]] as const) {
      for (const [item, s] of Object.entries(slots) as [ItemId, Slot][]) {
        const k = `${b.id}:${side}:${item}`;
        const e = expect.get(k) ?? 0;
        expect.delete(k);
        if (s.r !== e) problems.push(`${BUILDINGS[b.type].name} ${b.id} ${side} ${item}: r=${s.r}, jobs say ${e}`);
        if (s.n < 0) problems.push(`${BUILDINGS[b.type].name} ${b.id} ${side} ${item}: n=${s.n}`);
      }
    }
  }
  for (const [k, v] of expect) if (v !== 0) problems.push(`unmatched reservation ${k}: ${v}`);
  for (const h of sim.state.haulers) {
    if (h.job !== null && !jobById(sim, h.job)) problems.push(`hauler ${h.id} has a stale job ${h.job}`);
  }
  return problems;
}
