// Conveyors and arms: built once per link from its route, items drawn along
// it every frame, arms posed to follow what they carry. Reads only.

import * as THREE from 'three';
import type { ItemId } from '../data/items';
import { heightAt, type Terrain } from '../sim/terrain';
import type { Link } from '../sim/types';
import type { Sim } from '../sim/world';
import { Builder, kitMaterial } from './kit';
import { PALETTE } from './palette';
import type { WorldView } from './world-view';

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);

/** Top of the belt is this far below the route line. */
const BELT_TOP = -0.04;
/** Arms hold items this far below the gripper. */
const GRIP_DROP = 0.32;

interface ArmParts {
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  hand: THREE.Mesh;
  shoulder: THREE.Vector3;
  reach: number;
  grip: THREE.Vector3;
}

interface LView {
  id: number;
  mesh: THREE.Mesh;
  /** Cumulative length at each route point. */
  cum: number[];
  arm: ArmParts | null;
}

/** Frame at a route segment: x across, y up-ish, z along. */
function segFrame(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: THREE.Matrix4): number {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  dir.divideScalar(Math.max(len, 1e-6));
  const x = new THREE.Vector3().crossVectors(UP, dir);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(dir, x).normalize();
  out.makeBasis(x, y, dir).setPosition(ax, ay, az);
  return len;
}

function cumulative(p: number[]): number[] {
  const c = [0];
  for (let k = 3; k < p.length; k += 3) c.push(c[c.length - 1] + Math.hypot(p[k] - p[k - 3], p[k + 1] - p[k - 2], p[k + 2] - p[k - 1]));
  return c;
}

/** Point and segment index at distance s along a route. */
function pointAt(p: number[], cum: number[], s: number, out: THREE.Vector3): number {
  let k = 1;
  while (k < cum.length - 1 && cum[k] < s) k++;
  const seg = cum[k] - cum[k - 1];
  const t = seg > 0 ? Math.min(1, Math.max(0, (s - cum[k - 1]) / seg)) : 0;
  const a = (k - 1) * 3;
  const b = k * 3;
  out.set(p[a] + (p[b] - p[a]) * t, p[a + 1] + (p[b + 1] - p[a + 1]) * t, p[a + 2] + (p[b + 2] - p[a + 2]) * t);
  return k - 1;
}

/** Height of the route above an XZ point (nearest segment). */
function routeYAt(p: number[], x: number, z: number): number {
  let best = Infinity;
  let y = p[1];
  for (let k = 3; k < p.length; k += 3) {
    const ax = p[k - 3];
    const az = p[k - 1];
    const dx = p[k] - ax;
    const dz = p[k + 2] - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) {
      best = d;
      y = p[k - 2] + (p[k + 1] - p[k - 2]) * t;
    }
  }
  return y;
}

function conveyorGeometry(t: Terrain, l: Link): THREE.BufferGeometry {
  const B = new Builder();
  const p = l.path;
  const m = new THREE.Matrix4();
  for (let k = 3; k < p.length; k += 3) {
    const len = segFrame(p[k - 3], p[k - 2], p[k - 1], p[k], p[k + 1], p[k + 2], m);
    if (len < 1e-3) continue;
    B.at(m, () => {
      // Box frame, dark belt, side rails, ribs underneath.
      B.box('structure', 0.66, 0.16, len, 0, BELT_TOP - 0.22, len / 2, { c: 0.012 });
      B.box('seam', 0.54, 0.06, len, 0, BELT_TOP - 0.06, len / 2, { c: 0.008 });
      for (const sx of [-1, 1]) B.box('hullSecondary', 0.05, 0.16, len, sx * 0.31, BELT_TOP - 0.1, len / 2, { c: 0.01 });
      for (let s = 0.4; s < len - 0.2; s += 0.9) B.box('hullDark', 0.7, 0.05, 0.07, 0, BELT_TOP - 0.28, s, { c: 0.008 });
    });
    // A knuckle at each bend.
    if (k < p.length - 3) B.box('structure', 0.72, 0.24, 0.72, p[k], p[k + 1] + BELT_TOP - 0.26, p[k + 2], { c: 0.02, rotY: Math.atan2(p[k] - p[k - 3], p[k + 2] - p[k - 1]) });
  }
  // Housings where it meets a building.
  for (const [a, b] of [
    [0, 3],
    [p.length - 3, p.length - 6],
  ]) {
    const yaw = Math.atan2(p[b] - p[a], p[b + 2] - p[a + 2]);
    B.box('hullDark', 0.9, 0.62, 0.5, p[a], p[a + 1] - 0.38, p[a + 2], { rotY: yaw, c: 0.03 });
    B.box('logistics', 0.92, 0.05, 0.52, p[a], p[a + 1] + 0.22, p[a + 2], { rotY: yaw, c: 0.01 });
  }
  // Supports: a footing, a post, a yoke under the belt and two braces.
  for (let k = 0; k < l.supports.length; k += 2) {
    const x = l.supports[k];
    const z = l.supports[k + 1];
    const g = heightAt(t, x, z);
    const top = routeYAt(p, x, z) + BELT_TOP - 0.3;
    const yaw = supportYaw(p, x, z);
    B.box('pad', 0.62, 0.16, 0.62, x, g - 0.08, z, { rotY: yaw, c: 0.03 });
    B.box('structure', 0.17, top - g, 0.17, x, g + 0.06, z, { rotY: yaw, c: 0.015 });
    B.box('hullDark', 0.92, 0.1, 0.14, x, top - 0.08, z, { rotY: yaw, c: 0.012 });
    const cx = Math.cos(yaw);
    const cz = -Math.sin(yaw);
    for (const sx of [-1, 1]) B.beam('structure', [x, top - 0.75, z], [x + cx * sx * 0.4, top - 0.06, z + cz * sx * 0.4], 0.06);
  }
  return B.geometry();
}

function supportYaw(p: number[], x: number, z: number): number {
  let best = Infinity;
  let yaw = 0;
  for (let k = 3; k < p.length; k += 3) {
    const mx = (p[k - 3] + p[k]) / 2;
    const mz = (p[k - 1] + p[k + 2]) / 2;
    const len = Math.hypot(p[k] - p[k - 3], p[k + 2] - p[k - 1]);
    const d = Math.hypot(mx - x, mz - z) - len / 2;
    if (d < best && len > 0.01) {
      best = d;
      yaw = Math.atan2(p[k] - p[k - 3], p[k + 2] - p[k - 1]);
    }
  }
  return yaw;
}

/** An arm: a pedestal between the two buildings; the moving parts are separate meshes. */
function armParts(t: Terrain, l: Link, parent: THREE.Group, mat: THREE.Material): { base: THREE.BufferGeometry; arm: ArmParts } {
  const p = l.path;
  const n = p.length / 3;
  const ax = p[0];
  const az = p[2];
  const bx = p[(n - 1) * 3];
  const bz = p[(n - 1) * 3 + 2];
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const g = heightAt(t, mx, mz);
  const top = Math.min(p[1], p[(n - 1) * 3 + 1]) - 0.5;
  const B = new Builder();
  B.box('pad', 0.8, 0.14, 0.8, mx, g - 0.06, mz, { c: 0.03 });
  B.cyl('structure', 0.2, 0.26, top - g, mx, g, mz, { segs: 12 });
  B.cyl('hullSecondary', 0.3, 0.3, 0.16, mx, top - 0.02, mz, { segs: 14 });
  const shoulder = new THREE.Vector3(mx, top + 0.22, mz);
  let reach = 0;
  for (let k = 0; k < n; k++) reach = Math.max(reach, tmpV.set(p[k * 3], p[k * 3 + 1] + GRIP_DROP, p[k * 3 + 2]).distanceTo(shoulder));
  const seg = reach / 2 + 0.08;
  const limb = (role: 'hull' | 'logistics', w: number) => {
    const b = new Builder();
    b.box(role, w, 1, w, 0, 0, 0, { c: 0.02 });
    const mesh = new THREE.Mesh(b.geometry(), mat);
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    return mesh;
  };
  const hb = new Builder();
  hb.box('hullDark', 0.26, 0.12, 0.26, 0, -0.12, 0, { c: 0.02 });
  for (const sx of [-1, 1]) hb.box('structure', 0.04, 0.18, 0.2, sx * 0.11, -0.28, 0, { c: 0.008 });
  const hand = new THREE.Mesh(hb.geometry(), mat);
  hand.castShadow = true;
  hand.matrixAutoUpdate = false;
  parent.add(hand);
  return {
    base: B.geometry(),
    arm: { upper: limb('hull', 0.16), fore: limb('logistics', 0.12), hand, shoulder, reach: seg, grip: new THREE.Vector3(p[0], p[1] + GRIP_DROP, p[2]) },
  };
}

/** Place a unit limb (along +Y from its origin) from a to b. */
function poseLimb(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const d = tmpV.subVectors(b, a);
  const len = d.length();
  tmpQ.setFromUnitVectors(UP, d.divideScalar(Math.max(len, 1e-6)));
  tmpS.set(1, len, 1);
  mesh.matrix.compose(a, tmpQ, tmpS);
  tmpS.set(1, 1, 1);
}

export class LinkView {
  readonly group = new THREE.Group();
  private views = new Map<number, LView>();
  private snaps = new Map<number, { moved: number; pos: number[] }>();
  private mat = kitMaterial();
  private doomedMat = kitMaterial().clone() as THREE.MeshStandardMaterial;
  private ghost: THREE.Mesh | null = null;
  private ghostKey = '';
  /** Link the demolish tool points at. */
  doomed: number | null = null;
  selected: number | null = null;

  constructor(private sim: Sim) {
    this.doomedMat.color.setHex(PALETTE.fault);
    this.doomedMat.emissive = new THREE.Color(PALETTE.fault);
    this.doomedMat.emissiveIntensity = 0.25;
  }

  setSim(sim: Sim) {
    for (const v of this.views.values()) this.remove(v);
    this.views.clear();
    this.snaps.clear();
    this.sim = sim;
    this.showGhost(null, true);
  }

  /** Before each tick: where items were, for smooth motion between ticks. */
  snapshot() {
    for (const l of this.sim.state.links) this.snaps.set(l.id, { moved: l.moved, pos: l.pos.slice() });
  }

  pickable(): THREE.Object3D[] {
    return [...this.views.values()].map((v) => v.mesh);
  }

  private add(l: Link): LView {
    const t = this.sim.d.terrain;
    let geo: THREE.BufferGeometry;
    let arm: ArmParts | null = null;
    if (l.type === 'arm') {
      const r = armParts(t, l, this.group, this.mat);
      geo = r.base;
      arm = r.arm;
    } else geo = conveyorGeometry(t, l);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.linkId = l.id;
    this.group.add(mesh);
    const v: LView = { id: l.id, mesh, cum: cumulative(l.path), arm };
    this.views.set(l.id, v);
    return v;
  }

  private remove(v: LView) {
    this.group.remove(v.mesh);
    v.mesh.geometry.dispose();
    if (v.arm) {
      for (const m of [v.arm.upper, v.arm.fore, v.arm.hand]) {
        this.group.remove(m);
        m.geometry.dispose();
      }
    }
  }

  update(alpha: number, dt: number, world: WorldView) {
    const seen = new Set<number>();
    for (const l of this.sim.state.links) {
      seen.add(l.id);
      const v = this.views.get(l.id) ?? this.add(l);
      v.mesh.material = this.doomed === l.id ? this.doomedMat : this.mat;
      this.drawItems(l, v, alpha, dt, world);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.remove(v);
        this.views.delete(id);
        this.snaps.delete(id);
      }
    }
  }

  /** Where item k is drawn: between last tick's position and this one's. */
  private drawPos(l: Link, k: number, alpha: number): number {
    const snap = this.snaps.get(l.id);
    const now = l.pos[k];
    if (!snap) return now;
    const j = k + (l.moved - snap.moved);
    const before = j >= 0 && j < snap.pos.length ? snap.pos[j] : now;
    return before + (now - before) * alpha;
  }

  private drawItems(l: Link, v: LView, alpha: number, dt: number, world: WorldView) {
    const p = l.path;
    if (v.arm) {
      const arm = v.arm;
      const target = new THREE.Vector3();
      if (l.items.length > 0) {
        pointAt(p, v.cum, this.drawPos(l, 0, alpha), target);
        target.y += GRIP_DROP;
        arm.grip.copy(target);
      } else {
        // Empty: swing back to the source for the next one.
        target.set(p[0], p[1] + GRIP_DROP, p[2]);
        const step = Math.max(0, dt) * l.speed * 1.5;
        const d = target.distanceTo(arm.grip);
        if (d <= step || dt <= 0) arm.grip.lerp(target, d <= step ? 1 : 0);
        else arm.grip.add(tmpV.subVectors(target, arm.grip).multiplyScalar(step / d));
      }
      // Two equal limbs; the elbow up and out over the line from shoulder to grip.
      const s = arm.shoulder;
      const g = arm.grip;
      const sg = new THREE.Vector3().subVectors(g, s);
      const d = Math.min(sg.length(), arm.reach * 2 - 1e-3);
      const u = sg.normalize();
      const upPerp = UP.clone().addScaledVector(u, -UP.dot(u));
      if (upPerp.lengthSq() < 1e-6) upPerp.set(1, 0, 0);
      upPerp.normalize();
      const h = Math.sqrt(Math.max(0, arm.reach * arm.reach - (d / 2) * (d / 2)));
      const elbow = s.clone().addScaledVector(u, d / 2).addScaledVector(upPerp, h);
      const hand = s.clone().addScaledVector(u, d);
      poseLimb(arm.upper, s, elbow);
      poseLimb(arm.fore, elbow, hand);
      arm.hand.matrix.makeTranslation(hand.x, hand.y, hand.z);
      if (l.items.length > 0) this.item(world, l.items[0], hand.x, hand.y - GRIP_DROP, hand.z, Math.atan2(u.x, u.z), 0);
      return;
    }
    const m = new THREE.Matrix4();
    for (let k = 0; k < l.items.length; k++) {
      const s = this.drawPos(l, k, alpha);
      const seg = pointAt(p, v.cum, s, tmpV);
      const a = seg * 3;
      segFrame(p[a], p[a + 1], p[a + 2], p[a + 3], p[a + 4], p[a + 5], m);
      tmpQ.setFromRotationMatrix(m);
      m.compose(tmpV.setY(tmpV.y + BELT_TOP), tmpQ, tmpS);
      world.itemInstancer(l.items[k]).add(m);
    }
  }

  private item(world: WorldView, item: ItemId, x: number, y: number, z: number, yaw: number, _pitch: number) {
    tmpQ.setFromAxisAngle(UP, yaw);
    tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS);
    world.itemInstancer(item).add(tmpM);
  }

  /** The link tool's preview: the route it would take, orange if it can be made, red if not. */
  showGhost(path: number[] | null, ok: boolean, supports: number[] = []) {
    const key = path ? `${ok}:${path.map((x) => x.toFixed(2)).join(',')}` : '';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    if (this.ghost) {
      this.group.remove(this.ghost);
      this.ghost.geometry.dispose();
      this.ghost = null;
    }
    if (!path) return;
    const B = new Builder();
    for (let k = 3; k < path.length; k += 3) {
      B.beam(ok ? 'logistics' : 'fault', [path[k - 3], path[k - 2], path[k - 1]], [path[k], path[k + 1], path[k + 2]], 0.18);
    }
    const t = this.sim.d.terrain;
    for (let k = 0; k < supports.length; k += 2) {
      const x = supports[k];
      const z = supports[k + 1];
      B.beam('logistics', [x, heightAt(t, x, z), z], [x, routeYAt(path, x, z) - 0.1, z], 0.1);
    }
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false });
    this.ghost = new THREE.Mesh(B.geometry(), mat);
    this.ghost.renderOrder = 5;
    this.group.add(this.ghost);
  }
}

