// Driving a hauler along its path, among buildings and other haulers.
//
// Three layers (architecture.md, "Hauler movement and traffic"):
//  1. Route planning goes round haulers that are standing still (see
//     stampStanding and the replan check in haul.ts).
//  2. Every tick, a fan of arcs within the turning circle is swept with the
//     hauler's real outline; the best free one is driven. Reversing is just
//     the best arc being a reverse one.
//  3. In any meeting one hauler has right of way and the other yields.

import { DRIVE, DT, HAULER, TICK_RATE } from '../data/tunables';
import { buildingBody, queryIndex } from './build';
import { addWear, crowdFactor, groundSpeed } from './ground';
import { angleDiff } from './geom';
import { solidAt } from './nav';
import { heightAt } from './terrain';
import type { Hauler } from './types';
import type { Sim } from './world';

export function forward(h: number): [number, number] {
  return [Math.sin(h), Math.cos(h)];
}

// ---------------------------------------------------------------------------
// Paths

/** The last waypoint index of the leg the hauler is on (a leg ends where it must stop and change direction). */
export function legEnd(h: Hauler): number {
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

/** Remaining length of the whole path from the hauler's position. */
function pathLeft(h: Hauler): number {
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

/** Is (px, pz) inside one of the two circles the hauler cannot turn tighter than? */
export function insideTurningCircle(h: Hauler, px: number, pz: number): boolean {
  const R = HAULER.minTurnRadius;
  const lx = Math.cos(h.heading);
  const lz = -Math.sin(h.heading);
  for (const s of [1, -1]) {
    if (Math.hypot(px - (h.x + lx * s * R), pz - (h.z + lz * s * R)) < R * 0.95) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rectangles, without allocation in the inner loop

interface Box {
  cx: number;
  cz: number;
  /** Unit local x (across) and z (along) axes. */
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  hx: number;
  hz: number;
}

function makeBox(x: number, z: number, heading: number, hx: number, hz: number, out?: Box): Box {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  const b = out ?? ({} as Box);
  b.cx = x;
  b.cz = z;
  b.ux = c;
  b.uz = -s;
  b.vx = s;
  b.vz = c;
  b.hx = hx;
  b.hz = hz;
  return b;
}

function radius(a: Box, ax: number, az: number): number {
  return a.hx * Math.abs(a.ux * ax + a.uz * az) + a.hz * Math.abs(a.vx * ax + a.vz * az);
}

function boxesOverlap(a: Box, b: Box): boolean {
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  // Four separating axes: both boxes' local axes.
  let ax = a.ux, az = a.uz;
  if (Math.abs(dx * ax + dz * az) >= a.hx + radius(b, ax, az)) return false;
  ax = a.vx; az = a.vz;
  if (Math.abs(dx * ax + dz * az) >= a.hz + radius(b, ax, az)) return false;
  ax = b.ux; az = b.uz;
  if (Math.abs(dx * ax + dz * az) >= b.hx + radius(a, ax, az)) return false;
  ax = b.vx; az = b.vz;
  if (Math.abs(dx * ax + dz * az) >= b.hz + radius(a, ax, az)) return false;
  return true;
}

/** How deep two boxes interpenetrate (smallest overlap over the separating axes); ≤ 0 if apart. */
function penetration(a: Box, b: Box): number {
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  let m = Infinity;
  const axes: [number, number, number][] = [
    [a.ux, a.uz, a.hx],
    [a.vx, a.vz, a.hz],
  ];
  for (const [ax, az, ha] of axes) m = Math.min(m, ha + radius(b, ax, az) - Math.abs(dx * ax + dz * az));
  for (const [ax, az, hb] of [
    [b.ux, b.uz, b.hx],
    [b.vx, b.vz, b.hz],
  ] as [number, number, number][]) m = Math.min(m, hb + radius(a, ax, az) - Math.abs(dx * ax + dz * az));
  return m;
}

// ---------------------------------------------------------------------------
// Traffic: everyone as they were at the start of the tick

export interface Seen {
  id: number;
  x: number;
  z: number;
  heading: number;
  /** Direction of travel (reversing flips it). */
  fx: number;
  fz: number;
  speed: number;
  /** Standing: will not move for a while (loading, parked, or stopped for a second). */
  standing: boolean;
  loaded: boolean;
  /** Between walls: has right of way over anyone outside. */
  narrow: boolean;
  squeezing: boolean;
}

export interface Traffic {
  seen: Seen[];
  cells: Map<number, number[]>;
}

const TCELL = 4;

/** Walls close on both sides? */
function inNarrow(sim: Sim, h: Hauler): boolean {
  const lx = Math.cos(h.heading);
  const lz = -Math.sin(h.heading);
  const w = DRIVE.halfWidth + 1.3;
  return solidAt(sim, h.x + lx * w, h.z + lz * w, 0.2) && solidAt(sim, h.x - lx * w, h.z - lz * w, 0.2);
}

export function buildTraffic(sim: Sim): Traffic {
  const seen: Seen[] = [];
  const cells = new Map<number, number[]>();
  const standTicks = DRIVE.standAfter * TICK_RATE;
  for (const h of sim.state.haulers) {
    const [fx, fz] = forward(h.heading);
    const working = h.mode === 'idle' || h.mode === 'loading' || h.mode === 'unloading';
    const k = seen.length;
    seen.push({
      id: h.id,
      x: h.x,
      z: h.z,
      heading: h.heading,
      fx: fx * h.mdir,
      fz: fz * h.mdir,
      speed: h.speed,
      standing: working || h.still >= standTicks,
      loaded: h.cargo !== null,
      narrow: !working && h.speed > 0.05 && inNarrow(sim, h),
      squeezing: h.squeeze > 0,
    });
    const key = Math.floor(h.x / TCELL) * 1024 + Math.floor(h.z / TCELL);
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(k);
  }
  return { seen, cells };
}

export function* near(tr: Traffic, x: number, z: number, r: number): Generator<Seen> {
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

/** Does `a` have right of way over `b`? In a narrow place first, then loaded, then the lower number. */
function hasPriority(a: Seen, b: Seen): boolean {
  if (a.narrow !== b.narrow) return a.narrow;
  if (a.loaded !== b.loaded) return a.loaded;
  return a.id < b.id;
}

// ---------------------------------------------------------------------------
// What a hauler must not run into this tick

interface Mover {
  box: Box;
  vx: number;
  vz: number;
  /** Check it this many seconds either side of when we get there (right of way: be generous). */
  slack: number;
  /** Also keep clear of where it is now: it might stop (the one in front). */
  mayStop: boolean;
}

interface Obstacles {
  /** Buildings (grown by the solid margin). */
  solids: Box[];
  /** Solids the hauler is already touching, and how deeply: it may only move so as to get out. */
  stuckIn: Box[];
  stuckDepth: number[];
  /** Haulers standing still, and the paths of haulers with right of way. */
  fixed: Box[];
  /** Haulers ahead going our way, and ones with right of way over us: predicted by time. */
  movers: Mover[];
  /** Haulers we only must not touch right now (we have right of way, or they are behind us). */
  contact: Box[];
  /** Haulers already touching this one, and how deeply: it may only move so as not to go further in. */
  touching: Box[];
  touchDepth: number[];
  /** Ignore other haulers altogether (squeezing past). */
  ghost: boolean;
}

function gather(sim: Sim, h: Hauler, me: Seen, tr: Traffic, reach: number): Obstacles {
  const ob: Obstacles = { solids: [], stuckIn: [], stuckDepth: [], fixed: [], movers: [], contact: [], touching: [], touchDepth: [], ghost: h.squeeze > 0 };
  const probe = { cx: h.x, cz: h.z, hx: reach, hz: reach, rot: 0 };
  const body = makeBox(h.x, h.z, h.heading, DRIVE.halfWidth, DRIVE.halfLength);
  for (const id of queryIndex(sim.d.index, probe)) {
    const o = buildingBody(sim.d.byId.get(id)!);
    const b = makeBox(o.cx, o.cz, o.rot, o.hx + DRIVE.solidMargin, o.hz + DRIVE.solidMargin);
    if (boxesOverlap(body, b)) {
      ob.stuckIn.push(b);
      ob.stuckDepth.push(penetration(body, b));
    } else ob.solids.push(b);
  }
  if (ob.ghost) return ob;
  const mine = makeBox(h.x, h.z, h.heading, DRIVE.halfWidth, DRIVE.halfLength);
  const m = DRIVE.haulerMargin;
  for (const o of near(tr, h.x, h.z, reach + 2)) {
    if (o.id === h.id || o.squeezing) continue;
    const now = makeBox(o.x, o.z, o.heading, DRIVE.halfWidth + m, DRIVE.halfLength + m);
    // Already touching: it may move away (or along), but not further in.
    const real = makeBox(o.x, o.z, o.heading, DRIVE.halfWidth, DRIVE.halfLength);
    if (boxesOverlap(mine, real)) {
      ob.touching.push(real);
      ob.touchDepth.push(penetration(mine, real));
      continue;
    }
    if (o.standing || o.speed < 0.05) {
      ob.fixed.push(now);
      continue;
    }
    const same = me.fx * o.fx + me.fz * o.fz;
    // Which of us is in front, judged along our shared direction, so that
    // exactly one of a pair is the leader.
    const ahead = (o.x - h.x) * (me.fx + o.fx) + (o.z - h.z) * (me.fz + o.fz) > 0;
    if (same > 0.9 && !ahead) {
      // Behind us going our way: following is its job. Only don't reverse into it.
      ob.contact.push(now);
    } else if (same > 0.9) {
      // Ahead going our way: follow it, where it will be when we get there.
      ob.movers.push({ box: now, vx: o.fx * o.speed, vz: o.fz * o.speed, slack: 0, mayStop: true });
    } else if (hasPriority(me, o)) {
      // Crossing or oncoming, and we have right of way: only actual contact.
      ob.contact.push(now);
    } else {
      // It has right of way: keep well clear of where it will be, with room
      // to spare in space and in time.
      const pm = m + DRIVE.priorityMargin;
      ob.movers.push({ box: makeBox(o.x, o.z, o.heading, DRIVE.halfWidth + pm, DRIVE.halfLength + pm), vx: o.fx * o.speed, vz: o.fz * o.speed, slack: DRIVE.prioritySlack, mayStop: false });
    }
  }
  return ob;
}

const tmpBox = {} as Box;
/** "Actual contact": how far ahead haulers we needn't yield to are checked, metres. */
const CONTACT = 0.75;
/** Room to get clear of something already touched, metres. */
const ESCAPE = 0.75;
const tmpMover = {} as Box;

/** Trees, boulders, cliffs and the map edge, by sampling the outline. */
function hitsGround(sim: Sim, b: Box): boolean {
  const nav = sim.d.nav;
  const n = nav.size;
  for (let sx = -1; sx <= 1; sx++) {
    for (let sz = -1; sz <= 1; sz++) {
      const x = b.cx + b.ux * b.hx * sx + b.vx * b.hz * sz;
      const z = b.cz + b.uz * b.hx * sx + b.vz * b.hz * sz;
      const i = Math.floor(x);
      const j = Math.floor(z);
      if (i < 0 || j < 0 || i >= n || j >= n) return true;
      const k = j * n + i;
      if (nav.fixed[k] || nav.scen[k]) return true;
    }
  }
  return false;
}

/** How far the hauler can drive along an arc before touching anything (up to maxS). */
function sweep(sim: Sim, h: Hauler, ob: Obstacles, dir: number, kappa: number, maxS: number, vRef: number, vEnd = vRef): number {
  // Braking from vRef to vEnd first (giving way), then holding vEnd.
  const dec = HAULER.decel * 1.6;
  const db = vEnd < vRef ? (vRef * vRef - vEnd * vEnd) / (2 * dec) : 0;
  const tb = vEnd < vRef ? (vRef - vEnd) / dec : 0;
  // Where haulers we needn't yield to are now: keep out of it for as far as
  // it takes to stop.
  const contactS = Math.max(CONTACT, (h.speed * h.speed) / (2 * dec) + 0.3);
  // Ground is sampled on 1 m cells, so a hauler can end up wedged where every
  // move touches some: after a while stuck, it may clip it to get out.
  const startsOnGround = h.still >= DRIVE.wedgedAfter * TICK_RATE || hitsGround(sim, makeBox(h.x, h.z, h.heading, DRIVE.halfWidth, DRIVE.halfLength, tmpBox));
  let th = h.heading;
  let x = h.x;
  let z = h.z;
  const ds = DRIVE.sweepStep;
  const hw = DRIVE.halfWidth;
  const hl = DRIVE.halfLength;
  for (let s = ds; s <= maxS + 1e-6; s += ds) {
    th += kappa * ds;
    x += Math.sin(th) * ds * dir;
    z += Math.cos(th) * ds * dir;
    const b = makeBox(x, z, th, hw, hl, tmpBox);
    for (const o of ob.solids) if (boxesOverlap(b, o)) return s - ds;
    for (let q = 0; q < ob.stuckIn.length; q++) {
      // Getting out is fine; going deeper is not.
      const p = penetration(b, ob.stuckIn[q]);
      if (p > 0 && (s > ESCAPE || p > ob.stuckDepth[q] + 1e-3)) return s - ds;
    }
    if (hitsGround(sim, b) && (s > ESCAPE || !startsOnGround)) return s - ds;
    for (const o of ob.fixed) if (boxesOverlap(b, o)) return s - ds;
    for (let q = 0; q < ob.touching.length; q++) if (penetration(b, ob.touching[q]) > ob.touchDepth[q] + 1e-3) return s - ds;
    if (s <= contactS) for (const o of ob.contact) if (boxesOverlap(b, o)) return s - ds;
    let t: number;
    if (db <= 0) t = s / vRef;
    else if (s < db) t = (vRef - Math.sqrt(Math.max(0, vRef * vRef - 2 * dec * s))) / dec;
    else t = tb + (s - db) / vEnd;
    for (const mv of ob.movers) {
      const p = mv.box;
      if (mv.mayStop && boxesOverlap(b, p)) return s - ds;
      const th = Math.atan2(p.vx, p.vz);
      for (let dt = -mv.slack; dt <= mv.slack + 1e-6; dt += mv.slack > 0 ? mv.slack : 1) {
        const tt = Math.max(0, t + dt);
        makeBox(p.cx + mv.vx * tt, p.cz + mv.vz * tt, th, p.hx, p.hz, tmpMover);
        if (boxesOverlap(b, tmpMover)) return s - ds;
      }
    }
  }
  return maxS;
}

/** Pose at distance s along an arc. */
function poseAt(h: Hauler, dir: number, kappa: number, s: number): [number, number, number] {
  if (Math.abs(kappa) < 1e-6) {
    const [fx, fz] = forward(h.heading);
    return [h.x + fx * s * dir, h.z + fz * s * dir, h.heading];
  }
  // Exact for a circular arc driven with heading += κ·ds.
  const th1 = h.heading + kappa * s;
  const x = h.x + (dir * (Math.cos(h.heading) - Math.cos(th1))) / kappa;
  const z = h.z + (dir * (Math.sin(th1) - Math.sin(h.heading))) / kappa;
  return [x, z, th1];
}

interface Choice {
  dir: number;
  kappa: number;
  free: number;
  score: number;
  /** Speed limit the arc was judged at (slowing to let someone go first). */
  cap: number;
}

/**
 * Best arc in one direction: free for at least minFree, ending nearest the
 * pursuit point and pointing at it, smooth with what it was doing, and keeping
 * right when someone is coming the other way.
 */
function bestArc(sim: Sim, h: Hauler, ob: Obstacles, dir: number, px: number, pz: number, maxS: number, vRef: number, oncoming: boolean, extra: number[], backOnto = false): Choice | null {
  const kMax = 1 / HAULER.minTurnRadius;
  let best: Choice | null = null;
  // Open road: if the natural steering arc is clear all the way, take it.
  if (dir > 0 && extra.length && !oncoming) {
    const free = sweep(sim, h, ob, dir, extra[0], maxS, vRef);
    if (free >= maxS) return { dir, kappa: extra[0], free, score: 0, cap: Infinity };
  }
  // With someone to give way to, each arc is also judged at a crawl: letting
  // them go first and passing behind is often better than swerving.
  const slow = ob.movers.length > 0 ? Math.max(0.6, vRef * DRIVE.yieldSpeed) : 0;
  const ks: number[] = extra.slice();
  for (let i = 0; i < DRIVE.fan; i++) ks.push(-kMax + (2 * kMax * i) / (DRIVE.fan - 1));
  for (const kappa of ks) {
    let free = sweep(sim, h, ob, dir, kappa, maxS, vRef);
    let cap = Infinity;
    if (slow > 0 && slow < vRef && free < DRIVE.judge) {
      const f2 = sweep(sim, h, ob, dir, kappa, maxS, Math.max(0.3, h.speed), slow);
      if (f2 > free + 0.5) {
        free = f2;
        cap = slow;
      }
    }
    if (free < DRIVE.minFree) continue;
    const e = Math.min(free, DRIVE.judge);
    const [x, z, th] = poseAt(h, dir, kappa, e);
    const thM = th + (dir < 0 ? Math.PI : 0);
    const off = Math.abs(angleDiff(Math.atan2(px - x, pz - z), thM));
    // After the arc it would be driving forwards: how well does it then point?
    const point = Math.abs(angleDiff(Math.atan2(px - x, pz - z), th));
    // Driving towards it (forwards, or backing onto a dock or bay): point the
    // direction of travel at it. Backing up to turn round: point the nose.
    let score = Math.hypot(px - x, pz - z) + 0.6 * (dir > 0 || backOnto ? off : point);
    score += 0.4 * Math.abs(kappa - h.curv) * HAULER.minTurnRadius;
    if (free < DRIVE.judge) score += (DRIVE.judge - free) * 1.5;
    // Reversing is a way to turn round, not a way to travel.
    if (dir < 0 && !backOnto) score += e * DRIVE.reverseCost;
    if (oncoming && dir > 0) score += Math.max(0, kappa) * HAULER.minTurnRadius * 0.6;
    if (cap < Infinity) score += DRIVE.yieldCost;
    if (!best || score < best.score - 1e-9) best = { dir, kappa, free, score, cap };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Driving

/** 'redock': backing onto the spot isn't working out; drive onto it forwards instead. */
export type DriveResult = 'driving' | 'arrived' | 'redock' | 'reapproach';

/** Advance one tick. */
export function drive(sim: Sim, h: Hauler, tr: Traffic): DriveResult {
  if (h.hold > 0) {
    h.hold--;
    return 'driving';
  }
  const count = h.path.length / 2;
  if (h.pathI >= count) {
    h.speed = 0;
    return 'arrived';
  }
  if (h.pathI < 1) h.pathI = 1;

  // Advance past waypoints once passed; the end of a leg must be reached
  // properly (it is where the hauler stops to change direction).
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
  let reverseLeg = h.revFrom >= 0 && h.pathI >= h.revFrom;
  const ex = h.path[end * 2];
  const ez = h.path[end * 2 + 1];
  const dEnd = Math.hypot(ex - h.x, ez - h.z);
  const final = end === count - 1;
  const tight = 0.3;
  // Close to a dock spot it cannot drive any closer to: near enough.
  let closeEnough = !reverseLeg && final && dEnd < 0.9 && (insideTurningCircle(h, ex, ez) || h.still > TICK_RATE);
  if (!reverseLeg && !final) {
    // The point to start reversing from: near enough once it can't drive any
    // closer, or once it has gone past.
    const ax = h.path[end * 2 - 2];
    const az = h.path[end * 2 - 1];
    const past = (h.x - ex) * (ex - ax) + (h.z - ez) * (ez - az) > 0;
    closeEnough = dEnd < 0.5 || (dEnd < 1.2 && past);
  }
  // Going round in circles near a dock it can't line up with: after a while
  // plan a fresh approach from here; after longer, near enough is enough.
  if (!reverseLeg && (!final || h.mode !== 'home')) {
    if (dEnd < 3) {
      h.nearT++;
      if (h.nearT === DRIVE.reapproachAfter * TICK_RATE) return 'reapproach';
    }
    if (h.nearT > DRIVE.nearEnoughAfter * TICK_RATE && dEnd < DRIVE.nearEnough) closeEnough = true;
  }
  // Backing onto a dock or bay and stopped short: close enough (a bay is
  // stricter than a dock).
  if (reverseLeg && final && h.still >= TICK_RATE / 2 && dEnd < (h.mode === 'home' ? 0.5 : 0.9)) closeEnough = true;
  if (dEnd < tight || closeEnough) {
    if (h.speed > 0.1) {
      h.speed = Math.max(0, h.speed - HAULER.decel * 1.6 * DT);
      return 'driving';
    }
    if (final) {
      h.speed = 0;
      h.path = [];
      h.pathI = 0;
      h.revFrom = -1;
      h.wait = 0;
      h.still = 0;
      h.man = 'drive';
      h.mdir = 1;
      h.curv = 0;
      return 'arrived';
    }
    // End of a forward leg: start the reversing leg.
    h.pathI = end + 1;
    end = legEnd(h);
    reverseLeg = true;
  }

  // Backing in from a poor start, the spot can end up inside the turning
  // circle in reverse too, or it is just taking too long: pull in forwards.
  if (reverseLeg && final && dEnd > 0.9 && h.mdir < 0 && h.manT > TICK_RATE) {
    if (h.manT > DRIVE.maxReverseLeg * TICK_RATE) return 'redock';
  }

  const me = tr.seen.find((s) => s.id === h.id)!;
  const g = sim.state.ground;
  const t = sim.d.terrain;
  const [hx, hz] = forward(h.heading);
  const top0 = HAULER.speed * groundSpeed(g, h.x, h.z) * crowdFactor(g, h.x, h.z);
  const climb = (heightAt(t, h.x + hx * 0.6 * h.mdir, h.z + hz * 0.6 * h.mdir) - heightAt(t, h.x, h.z)) / 0.6;
  const top = top0 / (1 + HAULER.climbPenalty * Math.max(0, climb));
  const maxS = Math.max(2, Math.min(6, (top * top) / (2 * HAULER.decel) + 1.2));
  const vRef = Math.max(1, h.speed);
  const ob = gather(sim, h, me, tr, maxS + 2);
  // Backing into a bay: first turn on the spot to face straight away from it.
  if (reverseLeg && final && dEnd > 0.6) {
    const want = Math.atan2(h.x - ex, h.z - ez);
    const off = angleDiff(want, h.heading);
    if (Math.abs(off) > (h.man === 'pivot' ? 0.02 : 0.1)) {
      h.man = 'pivot';
      if (h.speed > 0.05) {
        // Stop first, along the way it was going.
        h.speed = Math.max(0, h.speed - HAULER.decel * 1.6 * DT);
        const [fx, fz] = forward(h.heading);
        h.x += fx * h.speed * DT * h.mdir;
        h.z += fz * h.speed * DT * h.mdir;
        return 'driving';
      }
      h.speed = 0;
      const next = h.heading + Math.sign(off) * Math.min(Math.abs(off), HAULER.pivotRate * DT);
      if (canTurnTo(sim, h, ob, next)) {
        h.heading = next;
        h.still = 0;
      } else {
        h.still++;
        lastResort(h, tr);
      }
      return 'driving';
    }
    if (h.man === 'pivot') {
      h.man = 'drive';
      h.manT = 0;
    }
  }
  const [px, pz] = lookaheadPoint(h, reverseLeg ? 1.2 : DRIVE.pursuit);
  const aFwd = angleDiff(Math.atan2(px - h.x, pz - h.z), h.heading);
  let oncoming = false;
  for (const o of near(tr, h.x, h.z, 10)) {
    if (o.id !== h.id && o.speed > 0.3 && o.fx * me.fx + o.fz * me.fz < -0.5) oncoming = true;
  }
  // Pure pursuit's own curvature, tried along with the fan.
  const kMax = 1 / HAULER.minTurnRadius;
  const ld = Math.max(0.3, Math.hypot(px - h.x, pz - h.z));
  const kPursuit = Math.max(-kMax, Math.min(kMax, Math.abs(aFwd) > Math.PI / 2 ? Math.sign(aFwd) * kMax : (2 * Math.sin(aFwd)) / ld));

  let choice: Choice | null = null;
  if (reverseLeg) {
    // Parking: backwards only.
    const thM = h.heading + Math.PI;
    const a = angleDiff(Math.atan2(px - h.x, pz - h.z), thM);
    const kRev = Math.max(-kMax, Math.min(kMax, (2 * Math.sin(a)) / ld));
    choice = bestArc(sim, h, ob, -1, px, pz, 2, Math.max(1, h.speed), false, [kRev], true);
    h.man = 'drive';
  } else {
    const fwd = bestArc(sim, h, ob, 1, px, pz, maxS, vRef, oncoming, [kPursuit]);
    const reversing = h.mdir < 0 && h.man === 'shunt';
    // Stuck: a moment's wait first if other haulers are about (they may clear);
    // straight away if it is only walls.
    let company = false;
    for (const o of near(tr, h.x, h.z, 4)) if (o.id !== h.id) company = true;
    let stuck = h.still >= (company ? DRIVE.reverseAfter * TICK_RATE : 2);
    if (stuck && !fwd && h.still < DRIVE.waitForTraffic * TICK_RATE) {
      // Only moving traffic in the way? Then wait for it to pass.
      const still = { ...ob, movers: [] };
      if (bestArc(sim, h, still, 1, px, pz, maxS, vRef, false, [kPursuit])) stuck = false;
    }
    // Backing up is considered when already doing so, when stuck, or when the
    // way on is behind and too tight to swing round to.
    const behind = Math.abs(aFwd) > Math.PI / 2 && insideTurningCircle(h, px, pz);
    let rev: Choice | null = null;
    if (reversing || stuck || behind || !fwd) rev = bestArc(sim, h, ob, -1, px, pz, 2.5, Math.max(1, h.speed), false, []);
    if (reversing) {
      // Stop backing up as soon as it can drive on, more or less facing the way.
      const facing = Math.abs(aFwd) < (80 * Math.PI) / 180 && !insideTurningCircle(h, px, pz);
      // ...or once there is room ahead to swing round on full lock.
      const room = fwd !== null && fwd.free >= DRIVE.judge && (rev === null || fwd.score <= rev.score);
      const done =
        (h.manT >= DRIVE.minReverse * TICK_RATE && fwd !== null && fwd.free >= 1.2 && (facing || room)) ||
        h.manT >= DRIVE.maxReverse * TICK_RATE;
      choice = done || !rev ? fwd : rev;
    } else if (fwd && !(behind && rev && rev.score < fwd.score - 0.5)) {
      choice = fwd;
    } else if (rev && (stuck || behind)) {
      choice = rev;
    }
  }

  // Direction changes need a stop first.
  let dir = choice ? choice.dir : h.mdir;
  let kappa = choice ? choice.kappa : 0;
  let want = 0;
  if (choice) {
    if (choice.dir !== h.mdir && h.speed > 0.05) {
      // Braking to change direction: coast on the old arc, unless that runs
      // into something, in which case stop dead.
      dir = h.mdir;
      kappa = h.curv;
      want = 0;
      const coast = (h.speed * h.speed) / (2 * HAULER.decel * 1.6) + 0.1;
      if (sweep(sim, h, ob, dir, kappa, coast, Math.max(1, h.speed)) < coast) h.speed = 0;
    } else {
      if (choice.dir !== h.mdir) h.manT = 0;
      h.mdir = choice.dir;
      if (!reverseLeg) h.man = choice.dir < 0 ? 'shunt' : 'drive';
      // As fast as the free distance allows stopping in, the curve allows, and
      // the end of the leg allows.
      const topDir = dir < 0 ? HAULER.reverseSpeed * (reverseLeg ? 1 : HAULER.shuntSpeed / HAULER.reverseSpeed) : top;
      want = Math.min(topDir, Math.sqrt(2 * HAULER.decel * Math.max(0, choice.free - 0.3)));
      want = Math.min(want, Math.sqrt(HAULER.lateralAccel / Math.max(1e-3, Math.abs(kappa))));
      want = Math.min(want, Math.sqrt(2 * HAULER.decel * remaining(h)) + 0.05, choice.cap);
      if (dir > 0 && h.pathI < end) {
        // Slow for corners further along.
        const tx = h.path[h.pathI * 2];
        const tz = h.path[h.pathI * 2 + 1];
        const nx = h.path[h.pathI * 2 + 2] - tx;
        const nz = h.path[h.pathI * 2 + 3] - tz;
        const turn = Math.abs(angleDiff(Math.atan2(nx, nz), Math.atan2(tx - h.x, tz - h.z)));
        const vc = top * Math.max(0.35, 1 - turn / Math.PI);
        want = Math.min(want, Math.sqrt(vc * vc + 2 * HAULER.decel * Math.max(0, Math.hypot(tx - h.x, tz - h.z) - 1.0)));
      }
    }
  }
  h.manT++;

  // Going round in circles (a three-point turn that never comes right): no
  // headway along the path for a while, so turn on the spot to face the way.
  const left = pathLeft(h);
  if (left < h.bestLeft - 1) {
    h.bestLeft = left;
    h.bestLeftT = sim.state.tick;
  } else if (!reverseLeg && sim.state.tick - h.bestLeftT > DRIVE.loopAfter * TICK_RATE && Math.abs(aFwd) > 0.3 && h.man !== 'pivot') {
    h.bestLeftT = sim.state.tick;
    h.man = 'pivot';
    h.manT = 0;
  }
  if (h.man === 'pivot' && !reverseLeg) {
    if (Math.abs(aFwd) < 0.3 || h.manT > 3 * TICK_RATE) h.man = 'drive';
    else {
      h.speed = Math.max(0, h.speed - HAULER.decel * 1.6 * DT);
      if (h.speed < 0.05) {
        const next = h.heading + Math.sign(aFwd) * Math.min(Math.abs(aFwd), HAULER.pivotRate * DT);
        if (canTurnTo(sim, h, ob, next)) h.heading = next;
      }
      h.manT++;
      return 'driving';
    }
  }

  // Boxed in all round: turn on the spot towards the way on, if there is room.
  if (!choice && !reverseLeg && h.still >= DRIVE.pivotAfter * TICK_RATE && Math.abs(aFwd) > 0.3) {
    const next = h.heading + Math.sign(aFwd) * Math.min(Math.abs(aFwd), HAULER.pivotRate * DT);
    if (canTurnTo(sim, h, ob, next)) {
      h.heading = next;
      h.man = 'pivot';
    }
  }

  if (h.speed < want) h.speed = Math.min(want, h.speed + HAULER.accel * DT);
  else h.speed = Math.max(want, h.speed - HAULER.decel * 1.6 * DT);
  const step = h.speed * DT;
  if (step <= 1e-6) {
    h.still++;
    h.wait++;
    lastResort(h, tr);
    return 'driving';
  }
  h.still = 0;
  h.wait = 0;
  h.heading += kappa * step;
  h.curv = kappa;
  const [fx, fz] = forward(h.heading);
  h.x += fx * step * dir;
  h.z += fz * step * dir;
  h.odo += step;
  addWear(g, h.x, h.z, step);
  if (h.squeeze > 0) h.squeeze--;
  return 'driving';
}

function canTurnTo(sim: Sim, h: Hauler, ob: Obstacles, heading: number): boolean {
  const b = makeBox(h.x, h.z, heading, DRIVE.halfWidth, DRIVE.halfLength, tmpBox);
  for (let q = 0; q < ob.stuckIn.length; q++) if (penetration(b, ob.stuckIn[q]) > ob.stuckDepth[q] + 1e-3) return false;
  for (const o of ob.solids) if (boxesOverlap(b, o)) return false;
  if (hitsGround(sim, b)) return false;
  for (const o of ob.fixed) if (boxesOverlap(b, o)) return false;
  for (const mv of ob.movers) if (boxesOverlap(b, mv.box)) return false;
  for (const o of ob.contact) if (boxesOverlap(b, o)) return false;
  for (let q = 0; q < ob.touching.length; q++) if (penetration(b, ob.touching[q]) > ob.touchDepth[q] + 1e-3) return false;
  return true;
}

/** Stopped a long time with other haulers about: drive through them, briefly. */
function lastResort(h: Hauler, tr: Traffic) {
  if (h.squeeze > 0) {
    h.squeeze--;
    return;
  }
  if (h.still < DRIVE.squeezeAfter * TICK_RATE) return;
  for (const o of near(tr, h.x, h.z, 3.5)) {
    if (o.id !== h.id) {
      h.squeeze = Math.round(DRIVE.squeeze * TICK_RATE);
      h.squeezes++;
      h.still = 0;
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 1: haulers standing still are obstacles to route planning

/** Stamp standing haulers onto the planning overlay (cleared and redone every tick). */
export function stampStanding(sim: Sim, tr: Traffic) {
  const nav = sim.d.nav;
  const n = nav.size;
  const stand = nav.stand;
  for (const k of nav.standCells) stand[k] = 0;
  nav.standCells.length = 0;
  const r = DRIVE.standRadius;
  for (const o of tr.seen) {
    if (!o.standing) continue;
    for (let j = Math.max(0, Math.floor(o.z - r)); j <= Math.min(n - 1, Math.floor(o.z + r)); j++) {
      for (let i = Math.max(0, Math.floor(o.x - r)); i <= Math.min(n - 1, Math.floor(o.x + r)); i++) {
        if (Math.hypot(i + 0.5 - o.x, j + 0.5 - o.z) > r) continue;
        const k = j * n + i;
        if (!stand[k]) nav.standCells.push(k);
        stand[k] = o.id;
      }
    }
  }
}

/** Does the path ahead run into a standing hauler (other than near its end)? */
export function standingAhead(sim: Sim, h: Hauler): boolean {
  const nav = sim.d.nav;
  const n = nav.size;
  const count = h.path.length / 2;
  if (count < 2) return false;
  const endX = h.path[count * 2 - 2];
  const endZ = h.path[count * 2 - 1];
  let px = h.x;
  let pz = h.z;
  let left = DRIVE.replanLook;
  for (let k = Math.max(1, h.pathI); k < count && left > 0; k++) {
    const x = h.path[k * 2];
    const z = h.path[k * 2 + 1];
    const seg = Math.hypot(x - px, z - pz);
    const steps = Math.max(1, Math.ceil(seg / 0.5));
    for (let s = 1; s <= steps; s++) {
      const qx = px + ((x - px) * s) / steps;
      const qz = pz + ((z - pz) * s) / steps;
      if (Math.hypot(qx - endX, qz - endZ) < DRIVE.standExempt || Math.hypot(qx - h.x, qz - h.z) < 1.5) continue;
      const id = nav.stand[Math.floor(qz) * n + Math.floor(qx)];
      if (id && id !== h.id) return true;
    }
    left -= seg;
    px = x;
    pz = z;
  }
  return false;
}
