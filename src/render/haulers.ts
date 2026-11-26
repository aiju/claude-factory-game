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
//
// A six-wheeled rover with a flat cargo deck and a screen for a head. The
// body is plain working hardware: steel tub, bogies, chipped paint, dirt. The
// head is tilted up so its visor, and the two eyes on it, face the camera.

const HEAD = new THREE.Matrix4().makeRotationX(-0.62).setPosition(0, 1.08, 0.6);

function haulerGeometry(): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; eyes: THREE.BufferGeometry } {
  const c = new Builder();
  const R = Math.PI / 2;
  // Running gear: three wheels a side on a bogie beam.
  for (const sx of [-1, 1]) {
    for (const z of [-0.62, 0, 0.62]) {
      c.cyl('structure', 0.21, 0.21, 0.17, sx * 0.56 + 0.085, 0.21, z, { rotZ: R, segs: 14, c: 0.04 });
      c.cyl('hullDark', 0.09, 0.09, 0.2, sx * 0.56 + 0.1, 0.21, z, { rotZ: R, segs: 8, c: 0.015, metal: 0.7 });
    }
    c.box('structure', 0.07, 0.09, 1.36, sx * 0.43, 0.17, 0, { c: 0.015 });
    for (const z of [-0.31, 0.31]) c.beam('hullDark', [sx * 0.43, 0.24, z], [sx * 0.36, 0.42, z * 0.6], 0.06, { metal: 0.5 });
    // Side armour and a battery box between the wheels.
    c.box('hull', 0.05, 0.2, 1.2, sx * 0.44, 0.38, -0.28, { c: 0.02 });
    c.box('hullSecondary', 0.1, 0.16, 0.34, sx * 0.47, 0.34, -0.31, { c: 0.02 });
    c.box('logistics', 0.03, 0.15, 0.36, sx * 0.41, 0.6, 0.58, { c: 0.008 });
  }
  // Tub.
  c.box('hullDark', 0.84, 0.26, 1.74, 0, 0.29, 0, { c: 0.05 });
  c.on('front', 0, 0.31, 0.88, () => c.hazard(0.84, 0.1, 0.07, 0, 0, 0, 0.14));
  c.box('structure', 0.88, 0.1, 0.07, 0, 0.31, -0.89, { c: 0.02 });
  for (const sx of [-1, 1]) {
    c.box('logistics', 0.12, 0.05, 0.03, sx * 0.3, 0.42, -0.885, { c: 0.008 });
    c.box('eye', 0.1, 0.07, 0.04, sx * 0.3, 0.6, 0.845, { c: 0.01 });
  }
  // Cargo deck with a low tube rail on three sides.
  c.box('trayFloor', 0.98, 0.05, 1.14, 0, 0.55, -0.3, { c: 0.012 });
  const y0 = 0.6, y1 = 0.8;
  const zf = 0.24, zb = -0.84, xr = 0.46;
  for (const [x, z] of [[-xr, zf], [-xr, -0.3], [-xr, zb], [xr, zf], [xr, -0.3], [xr, zb]]) c.beam('hullDark', [x, y0, z], [x, y1, z], 0.04, { metal: 0.4 });
  c.beam('hullDark', [-xr, y1, zf], [-xr, y1, zb], 0.04, { metal: 0.4 });
  c.beam('hullDark', [xr, y1, zf], [xr, y1, zb], 0.04, { metal: 0.4 });
  c.beam('hullDark', [-xr, y1, zb], [xr, y1, zb], 0.04, { metal: 0.4 });
  // Shoulder block: electronics under the head.
  c.box('hull', 0.8, 0.27, 0.52, 0, 0.55, 0.58, { c: 0.04 });
  for (const z of [0.44, 0.52]) c.box('structure', 0.26, 0.02, 0.04, -0.2, 0.82, z, { c: 0 });
  c.box('hullSecondary', 0.2, 0.06, 0.16, 0.24, 0.82, 0.48, { c: 0.015 });
  // Neck and a cable.
  c.cyl('hullDark', 0.07, 0.09, 0.2, 0, 0.8, 0.62, { segs: 10, metal: 0.7 });
  c.pipe('structure', [[0.2, 0.84, 0.46], [0.22, 1.0, 0.4], [0.16, 1.04, 0.5]], 0.02, { flanges: false });
  // Head.
  c.at(HEAD, () => {
    c.box('hull', 0.78, 0.46, 0.38, 0, -0.23, 0, { c: 0.045 });
    c.box('structure', 0.7, 0.38, 0.03, 0, -0.19, 0.19, { c: 0.01 });
    c.box('hullDark', 0.82, 0.05, 0.16, 0, 0.21, 0.13, { c: 0.012 });
    for (const sx of [-1, 1]) c.cyl('hullDark', 0.09, 0.09, 0.07, sx * 0.39 + 0.035, 0, 0, { rotZ: R, segs: 10, c: 0.015, metal: 0.7 });
    for (const x of [-0.2, 0, 0.2]) c.box('structure', 0.12, 0.3, 0.03, x, -0.15, -0.195, { c: 0.008 });
    c.beam('structure', [-0.3, 0.23, -0.1], [-0.34, 0.68, -0.14], 0.02, { round: true });
    c.geo('logistics', new THREE.SphereGeometry(0.035, 8, 6), -0.34, 0.69, -0.14);
  });

  const glass = new Builder();
  glass.at(HEAD, () => glass.geo('glass', plateGeo(0.66, 0.34, 0.03, 0.02), 0, 0, 0.212));
  const eyes = new Builder();
  eyes.at(HEAD, () => {
    for (const x of [-0.15, 0.15]) eyes.geo('eye', plateGeo(0.13, 0.2, 0.055, 0.012), x, 0, 0.226);
  });
  return { body: c.geometry(), glass: glass.geometry(), eyes: eyes.geometry() };
}

/** Top of the cargo deck, and its middle. */
const BED_Y = 0.6;
const BED_Z = -0.3;

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
    this.eyes = new Instancer(g.eyes, glowMaterial('eye', 'eye', 1.6), parent, 32, false);
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
