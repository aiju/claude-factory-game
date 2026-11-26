// Where a hauler's head looks. Like the eyes, it reads what is true in the
// sim: a bend coming up, the building it is about to load at, or the way it
// is going when reversing a long way. Pure logic, testable headlessly.

import { HEAD } from '../data/tunables';
import { angleDiff } from '../sim/geom';
import { lookaheadPoint, remaining } from '../sim/haul';
import type { Hauler } from '../sim/types';
import type { Sim } from '../sim/world';

export interface HeadMemory {
  /** Current yaw relative to the body, radians (+ is to the hauler's left). */
  yaw: number;
  /** Turned round to face backwards. */
  back: boolean;
  /** Seconds spent reversing / driving forward, uninterrupted. */
  revT: number;
  fwdT: number;
  /** Game time of the last turn round or back. */
  lastFlip: number;
}

export function newHeadMemory(): HeadMemory {
  return { yaw: 0, back: false, revT: 0, fwdT: 0, lastFlip: -Infinity };
}

function driving(h: Hauler) {
  return h.mode === 'pickup' || h.mode === 'drop' || h.mode === 'home';
}

/** The building the hauler is working with, if it is near it or at it. */
function buildingInView(sim: Sim, h: Hauler): { x: number; z: number } | null {
  const job = h.job === null ? undefined : sim.state.jobs.find((j) => j.id === h.job);
  if (!job) return null;
  const id = h.mode === 'pickup' || (h.mode === 'loading' && !job.loaded) ? job.from : job.to;
  const b = sim.d.byId.get(id);
  if (!b) return null;
  if (h.mode === 'loading' || h.mode === 'unloading') return b;
  const n = h.path.length;
  if (driving(h) && n && Math.hypot(h.path[n - 2] - h.x, h.path[n - 1] - h.z) < HEAD.buildingNear) return b;
  return null;
}

/** Update the head for `dt` seconds of game time at time `now`. Returns the yaw. */
export function updateHead(sim: Sim, h: Hauler, mem: HeadMemory, now: number, dt: number): number {
  const reversing = driving(h) && h.mdir < 0 && h.speed > 0.05;
  const forward = driving(h) && h.mdir > 0 && h.speed > 0.05;
  if (reversing) {
    mem.revT += dt;
    mem.fwdT = 0;
  } else if (forward) {
    mem.fwdT += dt;
    mem.revT = 0;
  }

  // Turn round for a long reverse; not for a short shunt, and not too often.
  if (!mem.back && reversing && now - mem.lastFlip > HEAD.minFlip) {
    const parkingLeg = h.revFrom >= 0 && h.pathI >= h.revFrom;
    if ((parkingLeg && remaining(h) > HEAD.reverseDistance) || mem.revT > HEAD.reverseTime) {
      mem.back = true;
      mem.lastFlip = now;
    }
  }
  if (mem.back && ((mem.fwdT > HEAD.forwardTime && now - mem.lastFlip > 1) || h.mode === 'idle' || h.mode === 'loading' || h.mode === 'unloading')) {
    mem.back = false;
    mem.lastFlip = now;
  }

  let target = 0;
  if (mem.back) {
    // Over the shoulder it is already nearest.
    target = mem.yaw >= 0 ? Math.PI : -Math.PI;
  } else {
    const b = buildingInView(sim, h);
    if (b) {
      const a = angleDiff(Math.atan2(b.x - h.x, b.z - h.z), h.heading);
      target = Math.max(-HEAD.maxLookAtBuilding, Math.min(HEAD.maxLookAtBuilding, a));
    } else if (forward && h.path.length) {
      // Look into the bend before the body gets there.
      const [px, pz] = lookaheadPoint(h, HEAD.lookAhead);
      const a = angleDiff(Math.atan2(px - h.x, pz - h.z), h.heading);
      target = Math.max(-HEAD.maxLook, Math.min(HEAD.maxLook, a * 0.8));
    }
  }
  const step = (target - mem.yaw) * Math.min(1, HEAD.smoothing * dt);
  const lim = HEAD.speed * dt;
  mem.yaw += Math.max(-lim, Math.min(lim, step));
  return mem.yaw;
}
