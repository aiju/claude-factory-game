// Haulers: instanced, interpolated between ticks, with a little suspension,
// lean and braking dip computed from the sim's motion.

import * as THREE from 'three';
import { DT } from '../data/tunables';
import { angleDiff } from '../sim/geom';
import { heightAt } from '../sim/terrain';
import type { Sim } from '../sim/world';
import { Instancer } from './instancer';
import { ITEM_STACK_HEIGHT } from './items';
import { Builder, glowMaterial, kitMaterial } from './kit';
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

function haulerGeometry(): { body: THREE.BufferGeometry; visor: THREE.BufferGeometry } {
  const c = new Builder();
  for (const x of [-0.37, 0.37]) {
    for (const z of [-0.38, 0.4]) {
      const w = new THREE.CylinderGeometry(0.17, 0.17, 0.13, 12);
      w.rotateZ(Math.PI / 2);
      w.translate(x, 0.17, z);
      c.geo('structure', w);
    }
  }
  c.box('structure', 0.66, 0.2, 1.16, 0, 0.14, 0, { bevel: 0.06 });
  c.box('structure', 0.7, 0.04, 0.6, 0, 0.34, -0.22, { bevel: 0.015 });
  c.box('hull', 0.68, 0.38, 0.44, 0, 0.32, 0.34, { bevel: 0.11 });
  c.box('logistics', 0.69, 0.06, 0.45, 0, 0.47, 0.34, { bevel: 0.02 });
  const v = new Builder();
  v.box('structure', 0.48, 0.07, 0.03, 0, 0.58, 0.565, { bevel: 0.01 });
  return { body: c.geometry(), visor: v.geometry() };
}

const BED_Y = 0.38;

const m4 = new THREE.Matrix4();
const m4b = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler(0, 0, 0, 'YXZ');
const v3 = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);
/** Drawn a little large relative to buildings, so they read from afar. */
const VISUAL_SCALE = new THREE.Vector3(1.3, 1.3, 1.3);

export class HaulerView {
  private body: Instancer;
  private visor: Instancer;
  private prev = new Map<number, Snap>();
  private motion = new Map<number, Motion>();
  private time = 0;

  constructor(
    private sim: Sim,
    parent: THREE.Object3D,
  ) {
    const g = haulerGeometry();
    this.body = new Instancer(g.body, kitMaterial(), parent, 32);
    const visorMat = glowMaterial('roadMark', 'roadMark', 0.9);
    this.visor = new Instancer(g.visor, visorMat, parent, 32, false);
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
    this.visor.begin();
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
      this.visor.add(m4);
      if (h.cargo && h.cargoN > 0) {
        const inst = world.itemInstancer(h.cargo);
        const hgt = ITEM_STACK_HEIGHT[h.cargo];
        for (let k = 0; k < h.cargoN; k++) {
          const layer = Math.floor(k / 4);
          const c = k % 4;
          v3.set(c % 2 === 0 ? -0.16 : 0.16, BED_Y + layer * hgt, -0.22 + (c < 2 ? -0.14 : 0.14));
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (k * 0.7) % 0.6);
          m4b.compose(v3, q, one);
          inst.add(m4b.premultiply(m4));
        }
      }
    }
    this.body.end();
    this.visor.end();
  }
}
