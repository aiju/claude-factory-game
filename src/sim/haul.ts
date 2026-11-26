// Haulers and the dispatcher. Everything that moves does so because of a
// request: inputs below target ask, outputs and the hub offer.

import { BUILDINGS } from '../data/buildings';
import type { ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { DISPATCH, DRIVE, HAULER, PARKING, TICK_RATE } from '../data/tunables';
import { dockLanes, dockPoint } from './build';
import type { CommandResult } from './commands';
import { angleDiff, toWorld } from './geom';
import { buildTraffic, drive, forward, stampStanding, standingAhead } from './drive';
import { blockedAt, findPath, lineClear, roundCorners } from './nav';
import { pruneOutputs } from './prod';
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
      still: 0,
      squeeze: 0,
      squeezes: 0,
      curv: 0,
      replanAt: -1e9,
      nearT: 0,
      bestLeft: Infinity,
      bestLeftT: 0,
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
  const p = loopPath(sim, h, tx, tz) ?? findPath(sim, h.x, h.z, tx, tz);
  h.pathI = 0;
  h.revFrom = -1;
  h.man = 'drive';
  h.manT = 0;
  h.nearT = 0;
  h.bestLeft = Infinity;
  if (!p) {
    h.path = [];
    return false;
  }
  // The start is kept as waypoint 0, so the first leg has a segment to follow.
  h.path = [h.x, h.z, ...p];
  h.pathI = 1;
  return true;
}

/**
 * When the way is back behind the hauler, swing round forwards in a loop
 * instead of a three-point turn, if there is room ahead: the route starts by
 * pulling forward and out to the side the way lies. Null if not needed or no
 * room.
 */
function loopPath(sim: Sim, h: Hauler, tx: number, tz: number): number[] | null {
  const direct = Math.atan2(tx - h.x, tz - h.z);
  const off = angleDiff(direct, h.heading);
  if (Math.abs(off) < (110 * Math.PI) / 180 || Math.hypot(tx - h.x, tz - h.z) < 4) return null;
  const nav = sim.d.nav;
  const [fx, fz] = forward(h.heading);
  const R = HAULER.minTurnRadius * 1.2;
  // Towards the side the way lies; failing that (a wall there), the other.
  for (const side of [Math.sign(off), -Math.sign(off)]) {
    // Turning by a positive angle swings the nose towards (fz, -fx).
    const rx = fz * side;
    const rz = -fx * side;
    const ax = h.x + fx * R;
    const az = h.z + fz * R;
    const bx = ax + rx * R;
    const bz = az + rz * R;
    // Swinging away from the way: carry on round until facing back.
    const pts = side === Math.sign(off) ? [ax, az, bx, bz] : [ax, az, bx + rx * R, bz + rz * R, bx + rx * R - fx * R, bz + rz * R - fz * R];
    let ok = true;
    let px = h.x;
    let pz = h.z;
    for (let k = 0; k < pts.length && ok; k += 2) {
      ok = lineClear(nav, px, pz, pts[k], pts[k + 1], 0.3);
      px = pts[k];
      pz = pts[k + 1];
    }
    if (!ok) continue;
    const p = findPath(sim, px, pz, tx, tz);
    if (!p) continue;
    return roundCorners(nav, h.x, h.z, [...pts, ...p]);
  }
  return null;
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
  if (b.type !== 'hub' && setAlongsidePath(sim, h, b, x, z)) return true;
  return setPath(sim, h, x, z);
}

/**
 * Pull up alongside a building's dock, the way a van stops at a kerb: the last
 * stretch runs parallel to the building's front, so it can drive off forwards
 * afterwards. From whichever side is nearer; false if neither has room.
 */
function setAlongsidePath(sim: Sim, h: Hauler, b: Building, x: number, z: number): boolean {
  const nav = sim.d.nav;
  const ax = Math.cos(b.rot);
  const az = -Math.sin(b.rot);
  const [ox, oz] = forward(b.rot);
  const run = DOCK_RUN_IN;
  // Start the run-in a little out from the wall, so it merges in gently.
  const out = 0;
  // Whichever side gets there for the least distance and turning: coming in
  // the wrong way round means a sharp turn onto the run-in.
  let best: number[] | null = null;
  let bestCost = Infinity;
  for (const side of [1, -1]) {
    const ex = x + ax * side * run + ox * out;
    const ez = z + az * side * run + oz * out;
    if (blockedAt(nav, ex, ez) || !lineClear(nav, ex, ez, x, z, 0.3)) continue;
    const p = loopPath(sim, h, ex, ez) ?? findPath(sim, h.x, h.z, ex, ez);
    if (!p) continue;
    let len = 0;
    let px = h.x;
    let pz = h.z;
    for (let k = 0; k < p.length; k += 2) {
      len += Math.hypot(p[k] - px, p[k + 1] - pz);
      if (k < p.length - 2) {
        px = p[k];
        pz = p[k + 1];
      }
    }
    const turn = Math.abs(angleDiff(Math.atan2(x - ex, z - ez), Math.atan2(ex - px, ez - pz)));
    const cost = len + turn * HAULER.minTurnRadius * 2;
    if (cost < bestCost) {
      bestCost = cost;
      best = p;
    }
  }
  if (!best) return false;
  h.path = [h.x, h.z, ...roundCorners(nav, h.x, h.z, [...best, x, z])];
  h.pathI = 1;
  h.revFrom = -1;
  h.man = 'drive';
  h.manT = 0;
  h.nearT = 0;
  h.bestLeft = Infinity;
  return true;
}

/** Length of the straight run-in alongside a dock, metres. */
const DOCK_RUN_IN = 4;

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
 * Park: drive up to a point straight out in front of the bay, turn on the spot
 * to face away from it, and reverse straight in. False if there is no room.
 */
function setParkPath(sim: Sim, h: Hauler, bay: { x: number; z: number; heading: number }): boolean {
  const nav = sim.d.nav;
  const [ox, oz] = forward(bay.heading);
  // Every other bay stops further out, so neighbours can turn at once.
  const out = PARKING.approach + (h.bay % 2) * PARKING.stagger;
  const fx = bay.x + ox * out;
  const fz = bay.z + oz * out;
  if (blockedAt(nav, fx, fz)) return false;
  const p = findPath(sim, h.x, h.z, fx, fz);
  if (!p) return false;
  const path = [h.x, h.z, ...p];
  h.revFrom = path.length / 2;
  path.push(bay.x, bay.z);
  h.path = path;
  h.pathI = 1;
  h.man = 'drive';
  h.manT = 0;
  h.nearT = 0;
  h.bestLeft = Infinity;
  return true;
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
// Movement: see drive.ts

/** Plan the route to wherever the hauler is going again. */
function replan(sim: Sim, h: Hauler) {
  const job = jobById(sim, h.job);
  const mdir = h.mdir;
  const man = h.man;
  const n = h.path.length;
  if (h.mode === 'home') goHome(sim, h);
  else if (job && (h.mode === 'pickup' || h.mode === 'drop')) {
    const b = sim.d.byId.get(h.mode === 'pickup' ? job.from : job.to);
    if (b) routeToDock(sim, h, b);
  } else if (n >= 2) setPath(sim, h, h.path[n - 2], h.path[n - 1]);
  // Keep whatever it was in the middle of (a stop before changing direction).
  h.mdir = mdir;
  h.man = man;
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
  stampStanding(sim, tr);
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
          if (sim.state.tick % 30 === h.id % 30) replan(sim, h);
          break;
        }
        // A hauler standing on the way ahead: plan round it, now and then.
        if (
          sim.state.tick - h.replanAt >= DRIVE.replanEvery * TICK_RATE &&
          (sim.state.tick + h.id) % 10 === 0 &&
          !(h.revFrom >= 0 && h.pathI >= h.revFrom - 1) &&
          standingAhead(sim, h)
        ) {
          h.replanAt = sim.state.tick;
          replan(sim, h);
          if (h.path.length === 0) break;
        }
        const r = drive(sim, h, tr);
        if (r === 'arrived') onArrive(sim, h);
        else if (r === 'reapproach') {
          // Can't line up from here: plan a fresh approach (parking picks its
          // side again).
          const n = h.path.length;
          const [x, z] = [h.path[n - 2], h.path[n - 1]];
          const nearT = h.nearT;
          if (h.mode === 'home') replan(sim, h);
          else if (!setPath(sim, h, x, z)) replan(sim, h);
          h.nearT = nearT;
        } else if (r === 'redock') {
          const n = h.path.length;
          const [x, z] = [h.path[n - 2], h.path[n - 1]];
          if (!setPath(sim, h, x, z)) replan(sim, h);
        }
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
