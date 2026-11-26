// Haulers and the dispatcher. Everything that moves does so because of a
// request: inputs below target ask, outputs and the hub offer.

import { BUILDINGS } from '../data/buildings';
import type { ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { DISPATCH, HAULER, TICK_RATE, DT } from '../data/tunables';
import { dockPoint } from './build';
import type { CommandResult } from './commands';
import { angleDiff, toWorld } from './geom';
import { findPath, lineClear } from './nav';
import { pruneOutputs } from './prod';
import { heightAt } from './terrain';
import type { Building, Hauler, Job, Slot } from './types';
import type { Sim } from './world';

// ---------------------------------------------------------------------------
// Parking

/** Bay position and heading (facing out) for bay `k` at a hub. */
export function bayPose(hub: Building, k: number): { x: number; z: number; heading: number } {
  const def = BUILDINGS[hub.type];
  if (k < 8) {
    const [x, z] = toWorld(hub.x, hub.z, hub.rot, -4.9 + k * 1.4, def.d / 2 + 1.05);
    return { x, z, heading: hub.rot };
  }
  const j = (k - 8) % 10;
  const left = j < 5;
  const lz = -3 + (j % 5) * 1.5;
  const lx = (left ? -1 : 1) * (def.w / 2 + 1.0);
  const [x, z] = toWorld(hub.x, hub.z, hub.rot, lx, lz);
  return { x, z, heading: hub.rot + (left ? -Math.PI / 2 : Math.PI / 2) };
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
      reverseLast: false,
      hold: 0,
      odo: 0,
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

function setPath(sim: Sim, h: Hauler, tx: number, tz: number, reverseFrom?: { x: number; z: number }): boolean {
  const target = reverseFrom ?? { x: tx, z: tz };
  const p = findPath(sim, h.x, h.z, target.x, target.z);
  if (!p) {
    h.path = [];
    h.pathI = 0;
    return false;
  }
  if (reverseFrom) p.push(tx, tz);
  h.path = p;
  h.pathI = 0;
  h.reverseLast = !!reverseFrom;
  return true;
}

function routeToDock(sim: Sim, h: Hauler, b: Building): boolean {
  const [x, z] = dockPoint(b, h.id);
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
  const [fx, fz] = forward(bay.heading);
  const approach = { x: bay.x + fx * 2.4, z: bay.z + fz * 2.4 };
  h.mode = 'home';
  if (!setPath(sim, h, bay.x, bay.z, approach)) {
    // Can't get to the bay; wait where we are.
    h.mode = 'idle';
  }
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
  for (const b of sim.state.buildings) {
    if (isHub(b)) continue;
    for (const [item, s] of Object.entries(b.out) as [ItemId, Slot][]) {
      const avail = s.n - s.r;
      if (avail <= 0) continue;
      if (avail >= DISPATCH.tidyMin || s.n >= s.cap) {
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

/** Remaining path length from the hauler's position. */
function remaining(h: Hauler): number {
  let d = 0;
  let px = h.x;
  let pz = h.z;
  for (let k = h.pathI; k < h.path.length / 2; k++) {
    const x = h.path[k * 2];
    const z = h.path[k * 2 + 1];
    d += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return d;
}

/** Advance along the path. Returns true on arrival at the final point. */
function drive(sim: Sim, h: Hauler): boolean {
  if (h.hold > 0) {
    h.hold--;
    return false;
  }
  const count = h.path.length / 2;
  if (h.pathI >= count) {
    h.speed = 0;
    return true;
  }
  let tx = h.path[h.pathI * 2];
  let tz = h.path[h.pathI * 2 + 1];
  let last = h.pathI === count - 1;
  // Advance past intermediate waypoints once close.
  while (!last && Math.hypot(tx - h.x, tz - h.z) < 0.9) {
    h.pathI++;
    tx = h.path[h.pathI * 2];
    tz = h.path[h.pathI * 2 + 1];
    last = h.pathI === count - 1;
  }
  const reverse = last && h.reverseLast;
  const dx = tx - h.x;
  const dz = tz - h.z;
  const d = Math.hypot(dx, dz);
  if (last && d < 0.06) {
    h.x = tx;
    h.z = tz;
    h.speed = 0;
    h.path = [];
    h.pathI = 0;
    return true;
  }
  const desired = reverse ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
  const err = angleDiff(desired, h.heading);
  const maxTurn = HAULER.turnRate * DT;
  h.heading += Math.max(-maxTurn, Math.min(maxTurn, err));

  // Target speed: top speed, slowed on climbs, for corners, to stop in time,
  // and while not yet pointing the right way.
  const t = sim.d.terrain;
  const [fx, fz] = forward(h.heading);
  const dir = reverse ? -1 : 1;
  const climb = (heightAt(t, h.x + fx * 0.6 * dir, h.z + fz * 0.6 * dir) - heightAt(t, h.x, h.z)) / 0.6;
  let v = (reverse ? HAULER.reverseSpeed : HAULER.speed) / (1 + HAULER.climbPenalty * Math.max(0, climb));
  v = Math.min(v, Math.sqrt(2 * HAULER.decel * remaining(h)) + 0.05);
  if (!last) {
    const nx = h.path[h.pathI * 2 + 2] - tx;
    const nz = h.path[h.pathI * 2 + 3] - tz;
    const turn = Math.abs(angleDiff(Math.atan2(nx, nz), Math.atan2(dx, dz)));
    const vc = HAULER.speed * Math.max(0.3, 1 - turn / Math.PI);
    v = Math.min(v, Math.sqrt(vc * vc + 2 * HAULER.decel * Math.max(0, d - 0.9)));
  }
  const align = Math.cos(Math.min(Math.abs(err), Math.PI / 2));
  v *= Math.max(0.12, align * align);
  if (h.speed < v) h.speed = Math.min(v, h.speed + HAULER.accel * DT);
  else h.speed = Math.max(v, h.speed - HAULER.decel * DT);
  const step = h.speed * DT;
  h.x += fx * step * dir;
  h.z += fz * step * dir;
  h.odo += step;
  return false;
}

function onArrive(sim: Sim, h: Hauler) {
  const job = jobById(sim, h.job);
  switch (h.mode) {
    case 'home': {
      h.mode = 'idle';
      const home = sim.d.byId.get(h.home);
      if (home) h.heading = bayPose(home, h.bay).heading;
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
        if (drive(sim, h)) onArrive(sim, h);
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
