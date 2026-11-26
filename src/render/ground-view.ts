// Feeds the sim's wear, road and crowd fields to the ground shader as a
// texture, one texel per nav cell, and draws haulers' routes in the traffic
// overlay. Reads only.

import * as THREE from 'three';
import { WEAR } from '../data/tunables';
import { heightAt, type Terrain } from '../sim/terrain';
import type { Sim } from '../sim/world';
import { PALETTE } from './palette';
import { groundUniforms } from './terrain-mesh';

export class GroundView {
  private tex: THREE.DataTexture;
  private data: Uint8Array;
  private acc = Infinity;
  private routes: THREE.LineSegments;
  private routePos = new Float32Array(0);
  overlay = false;

  constructor(
    private sim: Sim,
    parent: THREE.Object3D,
  ) {
    const n = sim.state.ground.size;
    this.data = new Uint8Array(n * n * 4);
    this.tex = new THREE.DataTexture(this.data, n, n, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
    groundUniforms.uWear.value = this.tex;
    groundUniforms.uWearSize.value = n;
    const mat = new THREE.LineBasicMaterial({ color: PALETTE.logistics, transparent: true, opacity: 0.9, depthTest: false });
    this.routes = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
    this.routes.frustumCulled = false;
    this.routes.renderOrder = 10;
    this.routes.visible = false;
    parent.add(this.routes);
  }

  setSim(sim: Sim) {
    this.sim = sim;
    this.acc = Infinity;
  }

  setOverlay(on: boolean) {
    this.overlay = on;
    groundUniforms.uOverlay.value = on ? 1 : 0;
    this.routes.visible = on;
    this.acc = Infinity;
  }

  /** `dt` is real seconds; the texture refreshes a few times a second. */
  update(dt: number) {
    this.acc += dt;
    if (this.acc >= (this.overlay ? 0.2 : 0.5)) {
      this.acc = 0;
      this.refreshTexture();
    }
    if (this.overlay) this.refreshRoutes();
  }

  private refreshTexture() {
    const g = this.sim.state.ground;
    const d = this.data;
    for (let k = 0; k < g.wear.length; k++) {
      const l = g.level[k];
      const w = g.wear[k];
      // Trampled: creeping up to a track, full once it is one.
      const r = l >= 1 ? 1 : Math.min(1, w / WEAR.trackOn) * 0.6;
      d[k * 4] = r * 255;
      d[k * 4 + 1] = l === 2 ? 255 : 0;
      d[k * 4 + 2] = Math.min(255, g.crowd[k] * 50);
      d[k * 4 + 3] = 255;
    }
    this.tex.needsUpdate = true;
  }

  private refreshRoutes() {
    const t = this.sim.d.terrain;
    const pts: number[] = [];
    for (const h of this.sim.state.haulers) {
      if (h.path.length === 0) continue;
      let px = h.x;
      let pz = h.z;
      for (let k = h.pathI; k < h.path.length / 2; k++) {
        const x = h.path[k * 2];
        const z = h.path[k * 2 + 1];
        // Split long legs so the line follows the ground.
        const len = Math.hypot(x - px, z - pz);
        const steps = Math.max(1, Math.ceil(len / 2));
        for (let s = 0; s < steps; s++) {
          const ax = px + ((x - px) * s) / steps;
          const az = pz + ((z - pz) * s) / steps;
          const bx = px + ((x - px) * (s + 1)) / steps;
          const bz = pz + ((z - pz) * (s + 1)) / steps;
          pts.push(ax, heightOf(t, ax, az), az, bx, heightOf(t, bx, bz), bz);
        }
        px = x;
        pz = z;
      }
    }
    if (pts.length !== this.routePos.length) this.routePos = new Float32Array(pts.length);
    this.routePos.set(pts);
    const geo = this.routes.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(this.routePos, 3));
    geo.setDrawRange(0, pts.length / 3);
  }
}

function heightOf(t: Terrain, x: number, z: number) {
  return heightAt(t, x, z) + 0.15;
}
