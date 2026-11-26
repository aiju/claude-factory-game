// Haulers: instanced, interpolated between ticks, with a little suspension,
// lean and braking dip computed from the sim's motion.

import * as THREE from 'three';
import { DT } from '../data/tunables';
import { angleDiff } from '../sim/geom';
import { heightAt } from '../sim/terrain';
import type { Sim } from '../sim/world';
import { Instancer } from './instancer';
import { ITEM_STACK_HEIGHT } from './items';
import { Builder, glowMaterial, kitMaterial, plateGeo } from './kit';
import { PALETTE } from './palette';
import type { WorldView } from './world-view';

interface Snap {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

interface Motion {
  pitch: number;
  roll: number;
}

// Local frame: +Z forward, origin on the ground under the middle.
// From above it reads as: wheels peeking out, a white cab with a raked visor
// and two eyes, an orange hoop, then a dark bed framed by white rails.

/** Tilt that lays a plate on the visor slope (its face pointing forward and up). */
const VISOR_TILT = -Math.atan2(0.43, 0.44);
const VISOR_MID = { y: 0.8, z: 0.735 };
const VISOR_NORMAL = { y: Math.cos(-VISOR_TILT), z: Math.sin(-VISOR_TILT) };

function onVisor(g: THREE.BufferGeometry, x: number, along: number, proud: number): THREE.BufferGeometry {
  // `along` runs up the slope from its middle; `proud` lifts off the surface.
  g.rotateX(VISOR_TILT);
  const upY = Math.cos(VISOR_TILT), upZ = Math.sin(VISOR_TILT);
  g.translate(x, VISOR_MID.y + upY * along + VISOR_NORMAL.y * proud, VISOR_MID.z + upZ * along + VISOR_NORMAL.z * proud);
  return g;
}

function haulerGeometry(): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; eyes: THREE.BufferGeometry } {
  const c = new Builder();
  // Wheels, with pale hubs.
  for (const x of [-0.52, 0.52]) {
    for (const z of [-0.56, 0.56]) {
      const w = new THREE.CylinderGeometry(0.25, 0.25, 0.22, 18);
      w.rotateZ(Math.PI / 2);
      c.geo('structure', w, x, 0.25, z);
      const hub = new THREE.CylinderGeometry(0.11, 0.11, 0.24, 12);
      hub.rotateZ(Math.PI / 2);
      c.geo('hullSecondary', hub, x, 0.25, z);
    }
  }
  // Chassis and bumpers.
  c.box('structure', 0.86, 0.2, 1.8, 0, 0.18, 0, { bevel: 0.06 });
  c.box('structure', 1.0, 0.13, 0.1, 0, 0.3, 0.93, { bevel: 0.04 });
  // Cab: nose, visor slope, roof.
  c.profile('hull', [[0.16, 0.34], [0.95, 0.34], [0.95, 0.58], [0.52, 1.02], [0.16, 1.02]], 1.06, 'x', 0, 0, 0, { bevel: 0.15, corner: 0.16 });
  // A stripe over the cab, just behind the visor.
  c.box('logistics', 1.09, 0.7, 0.11, 0, 0.345, 0.36, { bevel: 0.05 });
  // Bed: dark floor, white rails on three sides.
  c.box('trayFloor', 1.04, 0.08, 1.1, 0, 0.38, -0.42, { bevel: 0.02 });
  c.box('hull', 0.1, 0.24, 1.12, -0.48, 0.4, -0.42, { bevel: 0.04 });
  c.box('hull', 0.1, 0.24, 1.12, 0.48, 0.4, -0.42, { bevel: 0.04 });
  c.box('hull', 1.06, 0.24, 0.1, 0, 0.4, -0.93, { bevel: 0.04 });
  // Antenna with a small tip.
  c.cyl('structure', 0.018, 0.022, 0.5, -0.4, 1.0, 0.3, { segs: 6 });
  c.geo('logistics', new THREE.SphereGeometry(0.055, 10, 8), -0.4, 1.53, 0.3);

  const glass = new Builder();
  glass.geo('glass', onVisor(plateGeo(0.86, 0.5, 0.1, 0.03), 0, 0, 0.012));
  const eyes = new Builder();
  for (const x of [-0.2, 0.2]) eyes.geo('eye', onVisor(plateGeo(0.17, 0.26, 0.075, 0.012), x, 0.01, 0.034));
  return { body: c.geometry(), glass: glass.geometry(), eyes: eyes.geometry() };
}

/** Top of the bed floor, and the middle of the bed. */
const BED_Y = 0.46;
const BED_Z = -0.42;

const m4 = new THREE.Matrix4();
const m4b = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler(0, 0, 0, 'YXZ');
const v3 = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);
/** The model is built at its drawn size, which is larger than the sim's nominal hauler. */
const VISUAL_SCALE = new THREE.Vector3(1, 1, 1);

export class HaulerView {
  private body: Instancer;
  private glass: Instancer;
  private eyes: Instancer;
  private prev = new Map<number, Snap>();
  private motion = new Map<number, Motion>();
  private time = 0;

  constructor(
    private sim: Sim,
    parent: THREE.Object3D,
  ) {
    const g = haulerGeometry();
    this.body = new Instancer(g.body, kitMaterial(), parent, 32);
    const glassMat = new THREE.MeshStandardMaterial({ color: PALETTE.glass, roughness: 0.25, metalness: 0 });
    this.glass = new Instancer(g.glass, glassMat, parent, 32, false);
    this.eyes = new Instancer(g.eyes, glowMaterial('eye', 'eye', 1.0), parent, 32, false);
  }

  setSim(sim: Sim) {
    this.sim = sim;
    this.prev.clear();
    this.motion.clear();
  }

  /** Call before each sim tick, so rendering can interpolate. */
  snapshot() {
    for (const h of this.sim.state.haulers) {
      const s = this.prev.get(h.id);
      if (s) {
        s.x = h.x;
        s.z = h.z;
        s.heading = h.heading;
        s.speed = h.speed;
      } else this.prev.set(h.id, { x: h.x, z: h.z, heading: h.heading, speed: h.speed });
    }
  }

  update(alpha: number, dt: number, world: WorldView) {
    this.time += dt;
    const t = this.sim.d.terrain;
    this.body.begin();
    this.glass.begin();
    this.eyes.begin();
    for (const h of this.sim.state.haulers) {
      const p = this.prev.get(h.id) ?? h;
      const x = p.x + (h.x - p.x) * alpha;
      const z = p.z + (h.z - p.z) * alpha;
      const heading = p.heading + angleDiff(h.heading, p.heading) * alpha;
      const speed = p.speed + (h.speed - p.speed) * alpha;
      const accel = (h.speed - p.speed) / DT;
      const yawRate = angleDiff(h.heading, p.heading) / DT;
      let mo = this.motion.get(h.id);
      if (!mo) this.motion.set(h.id, (mo = { pitch: 0, roll: 0 }));
      if (dt > 0) {
        const k = 1 - Math.exp(-dt * 8);
        // Nose dips when braking; body leans into turns.
        const dir = h.mode === 'home' && h.reverseLast && h.pathI === h.path.length / 2 - 1 ? -1 : 1;
        mo.pitch += (Math.max(-0.08, Math.min(0.08, -accel * 0.018 * dir)) - mo.pitch) * k;
        mo.roll += (Math.max(-0.1, Math.min(0.1, -yawRate * speed * 0.03)) - mo.roll) * k;
      }
      // Sit on the ground, tilted to it.
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      const hf = heightAt(t, x + fx * 0.5, z + fz * 0.5);
      const hb = heightAt(t, x - fx * 0.5, z - fz * 0.5);
      const hr = heightAt(t, x + fz * 0.35, z - fx * 0.35);
      const hl = heightAt(t, x - fz * 0.35, z + fx * 0.35);
      const groundPitch = -Math.atan2(hf - hb, 1.0);
      const groundRoll = Math.atan2(hr - hl, 0.7);
      const bob = Math.sin(this.time * 11 + h.id * 1.7) * 0.012 * Math.min(1, speed / 2);
      v3.set(x, (hf + hb + hr + hl) / 4 + bob, z);
      e.set(groundPitch + mo.pitch, heading, groundRoll + mo.roll, 'YXZ');
      q.setFromEuler(e);
      m4.compose(v3, q, VISUAL_SCALE);
      this.body.add(m4);
      this.glass.add(m4);
      this.eyes.add(m4);
      if (h.cargo && h.cargoN > 0) {
        const inst = world.itemInstancer(h.cargo);
        const hgt = ITEM_STACK_HEIGHT[h.cargo];
        for (let k = 0; k < h.cargoN; k++) {
          const layer = Math.floor(k / 4);
          const c = k % 4;
          v3.set(c % 2 === 0 ? -0.2 : 0.2, BED_Y + layer * hgt, BED_Z + (c < 2 ? -0.22 : 0.22));
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (k * 0.7) % 0.6);
          m4b.compose(v3, q, one);
          inst.add(m4b.premultiply(m4));
        }
      }
    }
    this.body.end();
    this.glass.end();
    this.eyes.end();
  }
}
