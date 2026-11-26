// Soft snapping for placement: to a neighbour's rotation and edges, else to
// 15° steps. Reads the sim; changes nothing.

import { BUILDINGS, type BuildingTypeId } from '../data/buildings';
import { SNAP } from '../data/tunables';
import { angleDiff, toLocal, toWorld } from '../sim/geom';
import type { Sim } from '../sim/world';

export interface Pose {
  x: number;
  z: number;
  rot: number;
}

export function snapPose(sim: Sim, type: BuildingTypeId, raw: Pose, enabled: boolean): Pose {
  if (!enabled) return raw;
  const def = BUILDINGS[type];
  const r0 = Math.max(def.w, def.d) / 2;
  // Nearest neighbour by rough edge-to-edge distance.
  let best = null as null | { id: number; gap: number };
  for (const b of sim.state.buildings) {
    const bd = BUILDINGS[b.type];
    const gap = Math.hypot(b.x - raw.x, b.z - raw.z) - r0 - Math.max(bd.w, bd.d) / 2;
    if (gap < SNAP.range && (!best || gap < best.gap)) best = { id: b.id, gap };
  }
  const nb = best ? sim.d.byId.get(best.id)! : null;
  if (nb) {
    // Rotation: the neighbour's, or a quarter turn from it.
    let k = Math.round(angleDiff(raw.rot, nb.rot) / (Math.PI / 2));
    const target = nb.rot + k * (Math.PI / 2);
    if (Math.abs(angleDiff(raw.rot, target)) < SNAP.alignAngle) {
      k = ((k % 4) + 4) % 4;
      const nd = BUILDINGS[nb.type];
      const [lx, lz] = toLocal(nb.x, nb.z, nb.rot, raw.x, raw.z);
      const hx = k % 2 === 0 ? def.w / 2 : def.d / 2;
      const hz = k % 2 === 0 ? def.d / 2 : def.w / 2;
      const snapAxis = (v: number, nh: number, h: number, extra: number[] = []) => {
        const cands = [0, nh + h, -(nh + h), nh - h, -(nh - h), ...extra];
        let out = v;
        let bestD = SNAP.dist;
        for (const c of cands) {
          if (Math.abs(c - v) < bestD) {
            bestD = Math.abs(c - v);
            out = c;
          }
        }
        return out;
      };
      const sx = snapAxis(lx, nd.w / 2, hx);
      // In front of the neighbour, also offer "just clear of its dock".
      const sz = snapAxis(lz, nd.d / 2, hz, nd.dock ? [nd.d / 2 + nd.dock.d + hz] : []);
      const [x, z] = toWorld(nb.x, nb.z, nb.rot, sx, sz);
      return { x, z, rot: target };
    }
  }
  return { ...raw, rot: Math.round(raw.rot / SNAP.rotStep) * SNAP.rotStep };
}
