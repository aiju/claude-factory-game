// Links: conveyors and arms. A link is a queue of items moving along a fixed
// route from a socket on one building to a socket on another (architecture
// doc, "Links"). Routing is geometry, done once when the link is made.

import { BUILDINGS } from '../data/buildings';
import { ITEM_IDS, type ItemId } from '../data/items';
import { LINK, LINK_TYPES, type LinkTypeId } from '../data/links';
import { RECIPES } from '../data/recipes';
import { DT, PARKING } from '../data/tunables';
import { buildingBody, buildingDock, lowerName, queryIndex } from './build';
import { aabb, containsPoint, inflate, obbOverlap, toWorld, type OBB } from './geom';
import { bayPose } from './haul';
import { clearSceneryNear, navAddPost } from './nav';
import { recipeOutputs, slot } from './prod';
import { heightAt } from './terrain';
import type { Building, Link } from './types';
import type { Sim } from './world';

// ---------------------------------------------------------------------------
// Sockets

export interface Socket {
  x: number;
  z: number;
  y: number;
  /** Outward normal. */
  nx: number;
  nz: number;
}

/**
 * Attach points on a building's back and sides (the front has the dock), about
 * `LINK.socketSpacing` apart. Order is stable: back, left, right.
 */
export function sockets(b: Building): Socket[] {
  const def = BUILDINGS[b.type];
  const faces: [number, number, number, number, number, number, number][] = [
    // face centre (local), outward normal, tangent, length
    [0, -def.d / 2, 0, -1, 1, 0, def.w],
    [-def.w / 2, 0, -1, 0, 0, 1, def.d],
    [def.w / 2, 0, 1, 0, 0, 1, def.d],
  ];
  const out: Socket[] = [];
  for (const [cx, cz, nx, nz, tx, tz, len] of faces) {
    const n = Math.max(1, Math.floor(len / LINK.socketSpacing));
    for (let k = 0; k < n; k++) {
      const t = (k - (n - 1) / 2) * (len / n);
      const [x, z] = toWorld(b.x, b.z, b.rot, cx + tx * t, cz + tz * t);
      const [wx, wz] = toWorld(0, 0, b.rot, nx, nz);
      out.push({ x, z, y: b.y + LINK.socketHeight, nx: wx, nz: wz });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// What a link carries

/** Items the source makes that the destination uses (the hub makes and uses everything). */
export function carries(src: Building, dst: Building): ItemId[] {
  const makes: readonly ItemId[] = src.store ? ITEM_IDS : src.recipe ? recipeOutputs(RECIPES[src.recipe], src).map(([i]) => i) : [];
  if (dst.store) return [...makes];
  return makes.filter((i) => dst.inp[i] !== undefined);
}

/** Inputs fed by a link, as "buildingId:item". They no longer ask haulers. */
export function linkFed(sim: Sim): Set<string> {
  const fed = new Set<string>();
  for (const l of sim.state.links) {
    const src = sim.d.byId.get(l.from);
    const dst = sim.d.byId.get(l.to);
    if (src && dst && !dst.store) for (const i of carries(src, dst)) fed.add(`${dst.id}:${i}`);
  }
  return fed;
}

/** Outputs a link takes from, as "buildingId:item". The hub doesn't tidy these away. */
export function linkDrawn(sim: Sim): Set<string> {
  const out = new Set<string>();
  for (const l of sim.state.links) {
    const src = sim.d.byId.get(l.from);
    const dst = sim.d.byId.get(l.to);
    if (src && dst && !src.store) for (const i of carries(src, dst)) out.add(`${src.id}:${i}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Planning

export interface LinkPlan {
  ok: true;
  type: LinkTypeId;
  fromSocket: number;
  toSocket: number;
  path: number[];
  length: number;
  speed: number;
  spacing: number;
  height: number;
  supports: number[];
}
export interface LinkRefused {
  ok: false;
  reason: string;
  /** Where it would have gone, if a route was found: for drawing the refusal. */
  path?: number[];
}
export type LinkPlanResult = LinkPlan | LinkRefused;

/** Work out a link from one building to another without changing anything. */
export function planLink(sim: Sim, fromId: number, toId: number): LinkPlanResult {
  const src = sim.d.byId.get(fromId);
  const dst = sim.d.byId.get(toId);
  if (!src || !dst) return { ok: false, reason: 'No such building.' };
  if (src === dst) return { ok: false, reason: 'Pick another building to link to.' };
  if (carries(src, dst).length === 0) return { ok: false, reason: `Nothing to carry: ${lowerName(dst)} uses nothing ${lowerName(src)} makes.` };
  if (sim.state.links.some((l) => l.from === src.id && l.to === dst.id)) return { ok: false, reason: 'Already linked.' };

  const used = (b: Building) => {
    const s = new Set<number>();
    for (const l of sim.state.links) {
      if (l.from === b.id) s.add(l.fromSocket);
      if (l.to === b.id) s.add(l.toSocket);
    }
    return s;
  };
  const sa = sockets(src);
  const sb = sockets(dst);
  const ua = used(src);
  const ub = used(dst);
  const pairs: { i: number; j: number; d: number; score: number }[] = [];
  sa.forEach((a, i) => {
    if (ua.has(i)) return;
    sb.forEach((b, j) => {
      if (ub.has(j)) return;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const ux = (b.x - a.x) / Math.max(d, 1e-6);
      const uz = (b.z - a.z) / Math.max(d, 1e-6);
      const fa = a.nx * ux + a.nz * uz;
      const fb = -(b.nx * ux + b.nz * uz);
      pairs.push({ i, j, d, score: d + 6 * (Math.max(0, -fa) + Math.max(0, -fb)) + 1.5 * (2 - fa - fb) });
    });
  });
  if (pairs.length === 0) return { ok: false, reason: `No free socket on ${ua.size >= sa.length ? lowerName(src) : lowerName(dst)}.` };
  pairs.sort((p, q) => p.score - q.score || p.i - q.i || p.j - q.j);
  let first: LinkRefused | null = null;
  for (const p of pairs.slice(0, 16)) {
    const r = planPair(sim, src, dst, p.i, p.j, sa[p.i], sb[p.j]);
    if (r.ok) return r;
    first ??= r;
  }
  return first!;
}

function planPair(sim: Sim, src: Building, dst: Building, i: number, j: number, a: Socket, b: Socket): LinkPlanResult {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / Math.max(d, 1e-6);
  const uz = (b.z - a.z) / Math.max(d, 1e-6);
  if (d <= LINK_TYPES.arm.maxReach) {
    // An arm: reaches straight across, so both sockets must face the gap.
    if (a.nx * ux + a.nz * uz < 0.3 || -(b.nx * ux + b.nz * uz) < 0.3) return { ok: false, reason: 'The sockets face away from each other.' };
    if (routeHits(sim, [a.x, a.z, b.x, b.z], new Set([src.id, dst.id]), 0.1)) return { ok: false, reason: 'Something is in the way.' };
    const path: number[] = [];
    const lift = 0.7;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      path.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + lift * 4 * t * (1 - t), a.z + (b.z - a.z) * t);
    }
    const length = length3(path);
    return { ok: true, type: 'arm', fromSocket: i, toSocket: j, path, length, speed: LINK.armRate * length, spacing: length, height: Math.max(a.y, b.y) + lift, supports: [] };
  }
  const T = LINK_TYPES.conveyor;
  // Out of each socket, then straight across, or round whatever is in the way
  // by one or two bends.
  const a1x = a.x + a.nx * LINK.stub;
  const a1z = a.z + a.nz * LINK.stub;
  const b1x = b.x + b.nx * LINK.stub;
  const b1z = b.z + b.nz * LINK.stub;
  if (routeHits(sim, [a.x, a.z, a1x, a1z], new Set([src.id]), 0.1) || routeHits(sim, [b1x, b1z, b.x, b.z], new Set([dst.id]), 0.1)) {
    return { ok: false, reason: 'A socket is blocked.' };
  }
  const mx = (a1x + b1x) / 2;
  const mz = (a1z + b1z) / 2;
  const routes: number[][] = [[a1x, a1z, b1x, b1z]];
  for (const o of [3, 6, 10, 15]) for (const sgn of [1, -1]) routes.push([a1x, a1z, mx - uz * o * sgn, mz + ux * o * sgn, b1x, b1z]);
  for (const k of [2, 4, 7]) {
    routes.push([a1x, a1z, a1x + a.nx * k, a1z + a.nz * k, b1x, b1z]);
    routes.push([a1x, a1z, b1x + b.nx * k, b1z + b.nz * k, b1x, b1z]);
    routes.push([a1x, a1z, a1x + a.nx * k, a1z + a.nz * k, b1x + b.nx * k, b1z + b.nz * k, b1x, b1z]);
  }
  let best: number[] | null = null;
  let bestLen = Infinity;
  for (const r of routes) {
    const len = length2(r);
    if (len >= bestLen || routeHits(sim, r, null, LINK.routeMargin)) continue;
    best = r;
    bestLen = len;
  }
  const direct = [a.x, a.y, a.z, b.x, b.y, b.z];
  if (!best) return { ok: false, reason: 'No way round the buildings in between.', path: direct };
  const xz = [a.x, a.z, ...best, b.x, b.z];
  const total = length2(xz);
  if (total > T.maxReach) return { ok: false, reason: `Too long for a conveyor (${T.maxReach} m at most).`, path: profile(xz, a.y, b.y, a.y) };

  // Height: clear the ground, and go over any conveyor it crosses.
  let ground = -Infinity;
  for (let s = 0; s <= total; s += 1) {
    const [x, z] = along(xz, s);
    ground = Math.max(ground, heightAt(sim.d.terrain, x, z));
  }
  let H = ground + LINK.clearance;
  for (const l of sim.state.links) {
    if (l.type !== 'conveyor') continue;
    const y = crossingHeight(xz, l.path);
    if (y !== null) H = Math.max(H, y + LINK.tierStep);
  }
  const path = profile(xz, a.y, b.y, H);

  // Supports: no span longer than LINK.span, each on free ground nearby.
  const supports: number[] = [];
  const n = Math.ceil(total / LINK.span) - 1;
  for (let k = 1; k <= n; k++) {
    const ideal = (total * k) / (n + 1);
    let found = false;
    for (let off = 0; off <= LINK.supportSlide && !found; off += 0.5) {
      for (const sgn of off === 0 ? [1] : [1, -1]) {
        const s = ideal + off * sgn;
        if (s < 1 || s > total - 1) continue;
        const [x, z] = along(xz, s);
        if (!supportFree(sim, x, z, supports)) continue;
        supports.push(x, z);
        found = true;
        break;
      }
    }
    if (!found) {
      const [x, z] = along(xz, ideal);
      const near = buildingNear(sim, x, z);
      return { ok: false, reason: near ? `No room for a support next to ${lowerName(near)}.` : 'No room for a support along the way.', path };
    }
  }
  return { ok: true, type: 'conveyor', fromSocket: i, toSocket: j, path, length: length3(path), speed: T.speed, spacing: T.spacing, height: H, supports };
}

/** XZ polyline → 3D route: up from the first socket, level at H, down to the second. */
function profile(xz: number[], ya: number, yb: number, H: number): number[] {
  const total = length2(xz);
  const s0 = LINK.stub;
  const s1 = total - LINK.stub;
  const yAt = (s: number) => {
    if (s <= s0) return ya;
    if (s >= s1) return yb;
    return Math.min(H, ya + LINK.rampSlope * (s - s0), yb + LINK.rampSlope * (s1 - s));
  };
  // Every corner of the polyline, plus where the slope changes.
  const marks = new Set<number>();
  let acc = 0;
  marks.add(0);
  for (let k = 2; k < xz.length; k += 2) {
    acc += Math.hypot(xz[k] - xz[k - 2], xz[k + 1] - xz[k - 1]);
    marks.add(acc);
  }
  const upTop = s0 + (H - ya) / LINK.rampSlope;
  const downTop = s1 - (H - yb) / LINK.rampSlope;
  const peak = (yb - ya + LINK.rampSlope * (s0 + s1)) / (2 * LINK.rampSlope);
  for (const s of [s0, s1, upTop, downTop, peak]) if (s > 0 && s < total) marks.add(s);
  const out: number[] = [];
  for (const s of [...marks].sort((p, q) => p - q)) {
    const [x, z] = along(xz, s);
    const last = out.length - 3;
    if (last >= 0 && Math.hypot(out[last] - x, out[last + 2] - z) < 1e-4) continue;
    out.push(x, yAt(s), z);
  }
  return out;
}

/** Point at distance s along an XZ polyline. */
function along(xz: number[], s: number): [number, number] {
  let acc = 0;
  for (let k = 2; k < xz.length; k += 2) {
    const seg = Math.hypot(xz[k] - xz[k - 2], xz[k + 1] - xz[k - 1]);
    if (acc + seg >= s || k === xz.length - 2) {
      const t = seg > 0 ? Math.min(1, Math.max(0, (s - acc) / seg)) : 0;
      return [xz[k - 2] + (xz[k] - xz[k - 2]) * t, xz[k - 1] + (xz[k + 1] - xz[k - 1]) * t];
    }
    acc += seg;
  }
  return [xz[0], xz[1]];
}

function length2(xz: number[]): number {
  let d = 0;
  for (let k = 2; k < xz.length; k += 2) d += Math.hypot(xz[k] - xz[k - 2], xz[k + 1] - xz[k - 1]);
  return d;
}

function length3(p: number[]): number {
  let d = 0;
  for (let k = 3; k < p.length; k += 3) d += Math.hypot(p[k] - p[k - 3], p[k + 1] - p[k - 2], p[k + 2] - p[k - 1]);
  return d;
}

/** A segment as a thin box, for overlap tests. */
function segOBB(ax: number, az: number, bx: number, bz: number, half: number): OBB {
  const len = Math.hypot(bx - ax, bz - az);
  return { cx: (ax + bx) / 2, cz: (az + bz) / 2, hx: half, hz: len / 2 + half, rot: Math.atan2(bx - ax, bz - az) };
}

/** Does an XZ polyline pass through a building (other than `skip`)? */
function routeHits(sim: Sim, xz: number[], skip: Set<number> | null, margin: number): boolean {
  for (let k = 2; k < xz.length; k += 2) {
    const seg = segOBB(xz[k - 2], xz[k - 1], xz[k], xz[k + 1], 0.2);
    for (const id of queryIndex(sim.d.index, inflate(seg, margin))) {
      if (skip?.has(id)) continue;
      if (obbOverlap(seg, inflate(buildingBody(sim.d.byId.get(id)!), margin))) return true;
    }
  }
  return false;
}

/** Height of route `p` (3D) where the XZ polyline crosses it, or null. */
function crossingHeight(xz: number[], p: number[]): number | null {
  let best: number | null = null;
  for (let k = 2; k < xz.length; k += 2) {
    const ax = xz[k - 2];
    const az = xz[k - 1];
    const bx = xz[k];
    const bz = xz[k + 1];
    for (let q = 3; q < p.length; q += 3) {
      const cx = p[q - 3];
      const cz = p[q - 1];
      const dx = p[q];
      const dz = p[q + 2];
      const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
      const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const y = p[q - 2] + (p[q + 1] - p[q - 2]) * u;
      best = best === null ? y : Math.max(best, y);
    }
  }
  return best;
}

function supportFree(sim: Sim, x: number, z: number, mine: number[]): boolean {
  const nav = sim.d.nav;
  const n = nav.size;
  const i = Math.floor(x);
  const j = Math.floor(z);
  if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1 || nav.fixed[j * n + i]) return false;
  const m = LINK.supportMargin;
  const probe: OBB = { cx: x, cz: z, hx: m, hz: m, rot: 0 };
  for (const id of queryIndex(sim.d.index, probe)) {
    const b = sim.d.byId.get(id)!;
    if (containsPoint(inflate(buildingBody(b), m), x, z)) return false;
    const dock = buildingDock(b);
    if (dock && containsPoint(inflate(dock, m), x, z)) return false;
  }
  const hub = sim.d.byId.get(sim.state.hub);
  if (hub) {
    for (let k = 0; k < PARKING.front + PARKING.side * 2; k++) {
      const p = bayPose(hub, k);
      if (Math.hypot(p.x - x, p.z - z) < 1.6) return false;
    }
  }
  const others = [...mine];
  for (const l of sim.state.links) others.push(...l.supports);
  for (let k = 0; k < others.length; k += 2) if (Math.hypot(others[k] - x, others[k + 1] - z) < 1.2) return false;
  return true;
}

function buildingNear(sim: Sim, x: number, z: number): Building | null {
  let best: Building | null = null;
  let bd = 6;
  for (const b of sim.state.buildings) {
    const d = Math.hypot(b.x - x, b.z - z) - Math.max(BUILDINGS[b.type].w, BUILDINGS[b.type].d) / 2;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Would a building footprint sit on a link's route or a support? Null if not. */
export function linkInTheWay(sim: Sim, body: OBB): string | null {
  const box = inflate(body, 0.3);
  const a = aabb(box);
  for (const l of sim.state.links) {
    for (let k = 0; k < l.supports.length; k += 2) {
      if (containsPoint(inflate(box, LINK.supportRadius), l.supports[k], l.supports[k + 1])) return 'A conveyor support is in the way.';
    }
    for (let q = 3; q < l.path.length; q += 3) {
      const ax = l.path[q - 3];
      const az = l.path[q - 1];
      const bx = l.path[q];
      const bz = l.path[q + 2];
      if (Math.max(ax, bx) < a.x0 || Math.min(ax, bx) > a.x1 || Math.max(az, bz) < a.z0 || Math.min(az, bz) > a.z1) continue;
      if (obbOverlap(segOBB(ax, az, bx, bz, 0.25), box)) return l.type === 'arm' ? 'An arm is in the way.' : 'A conveyor runs here.';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Making and removing

export function addLink(sim: Sim, from: number, to: number, plan: LinkPlan): Link {
  const l: Link = {
    id: sim.state.nextId++,
    type: plan.type,
    from,
    to,
    fromSocket: plan.fromSocket,
    toSocket: plan.toSocket,
    path: plan.path,
    length: plan.length,
    speed: plan.speed,
    spacing: plan.spacing,
    height: plan.height,
    supports: plan.supports,
    items: [],
    pos: [],
    next: 0,
    moved: 0,
  };
  sim.state.links.push(l);
  for (let k = 0; k < l.supports.length; k += 2) clearSceneryNear(sim, l.supports[k], l.supports[k + 1], 0.6);
  navAddSupports(sim, l, 1);
  return l;
}

export function navAddSupports(sim: Sim, l: Link, delta: number) {
  for (let k = 0; k < l.supports.length; k += 2) navAddPost(sim, l.supports[k], l.supports[k + 1], LINK.supportRadius, delta);
}

/**
 * Take a link down. What is on it goes back to the source's output (as
 * leftovers on offer), or to the hub if the source is the hub or is going.
 */
export function removeLink(sim: Sim, l: Link, sourceGoing = false) {
  const i = sim.state.links.indexOf(l);
  if (i < 0) return;
  sim.state.links.splice(i, 1);
  navAddSupports(sim, l, -1);
  const src = sourceGoing ? undefined : sim.d.byId.get(l.from);
  const hub = sim.d.byId.get(sim.state.hub)!;
  for (const item of l.items) {
    if (src && !src.store) (src.out[item] ??= slot(0)).n++;
    else hub.store![item]!.n++;
  }
  l.items = [];
  l.pos = [];
}

// ---------------------------------------------------------------------------
// Ticking

export function tickLinks(sim: Sim) {
  const links = sim.state.links;
  const n = links.length;
  for (let q = 0; q < n; q++) {
    // Rotate who goes first, so links sharing a source take turns.
    const l = links[(q + sim.state.tick) % n];
    const src = sim.d.byId.get(l.from);
    const dst = sim.d.byId.get(l.to);
    if (!src || !dst) continue;
    const stepLen = l.speed * DT;
    for (let k = 0; k < l.pos.length; k++) {
      const limit = k === 0 ? l.length : l.pos[k - 1] - l.spacing;
      l.pos[k] = Math.max(l.pos[k], Math.min(l.pos[k] + stepLen, limit));
    }
    if (l.pos.length > 0 && l.pos[0] >= l.length - 1e-9 && accept(dst, l.items[0])) {
      l.items.shift();
      l.pos.shift();
      l.moved++;
    }
    const last = l.pos.length - 1;
    if (last < 0 || (l.pos[last] >= l.spacing && l.spacing < l.length)) take(l, src, dst);
  }
}

function accept(dst: Building, item: ItemId): boolean {
  if (dst.store) {
    dst.store[item]!.n++;
    return true;
  }
  const s = dst.inp[item];
  if (!s) {
    // The recipe changed under it: leave it on offer rather than lose it.
    (dst.out[item] ??= slot(0)).n++;
    return true;
  }
  if (s.n + s.r >= s.cap) return false;
  s.n++;
  return true;
}

function take(l: Link, src: Building, dst: Building) {
  const cand = carries(src, dst);
  if (cand.length === 0) return;
  for (let k = 0; k < cand.length; k++) {
    const item = cand[(l.next + k) % cand.length];
    const s = src.store ? src.store[item] : src.out[item];
    if (!s || s.n - s.r <= 0) continue;
    // Carrying several kinds (from the hub): only what the destination has room for.
    if (cand.length > 1 && !dst.store) {
      const d = dst.inp[item]!;
      let on = 0;
      for (const i of l.items) if (i === item) on++;
      if (d.n + d.r + on >= d.cap) continue;
    }
    s.n--;
    l.items.push(item);
    l.pos.push(0);
    l.next = (l.next + k + 1) % cand.length;
    return;
  }
}
