// The logistics overlay: who is asking whom for what. An arc for every flow
// haulers are carrying (source dock to destination dock, in the item's
// colour), and a stalk over each input that is asking with no one coming.
// Reads only.

import * as THREE from 'three';
import type { ItemId } from '../data/items';
import { dockPoint } from '../sim/build';
import { linkFed } from '../sim/links';
import { heightAt } from '../sim/terrain';
import type { Sim } from '../sim/world';
import { ITEM_COLOURS } from './palette';

export class LogisticsView {
  private lines: THREE.LineSegments;
  private acc = Infinity;
  overlay = false;

  constructor(
    private sim: Sim,
    parent: THREE.Object3D,
  ) {
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 11;
    this.lines.visible = false;
    parent.add(this.lines);
  }

  setSim(sim: Sim) {
    this.sim = sim;
    this.acc = Infinity;
  }

  setOverlay(on: boolean) {
    this.overlay = on;
    this.lines.visible = on;
    this.acc = Infinity;
  }

  update(dt: number) {
    if (!this.overlay) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const sim = this.sim;
    const t = sim.d.terrain;
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, item: ItemId, dim: number) => {
      c.setHex(ITEM_COLOURS[item]).multiplyScalar(dim);
      pos.push(ax, ay, az, bx, by, bz);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    // Flows carried by haulers, one arc per source, destination and item.
    const flows = new Map<string, { from: number; to: number; item: ItemId; n: number; loaded: number }>();
    for (const j of sim.state.jobs) {
      const k = `${j.from}:${j.to}:${j.item}`;
      const f = flows.get(k) ?? { from: j.from, to: j.to, item: j.item, n: 0, loaded: 0 };
      f.n++;
      if (j.loaded) f.loaded++;
      flows.set(k, f);
    }
    for (const f of flows.values()) {
      const a = sim.d.byId.get(f.from);
      const b = sim.d.byId.get(f.to);
      if (!a || !b) continue;
      const [ax, az] = dockPoint(a, 0);
      const [bx, bz] = dockPoint(b, 0);
      const ya = heightAt(t, ax, az) + 0.3;
      const yb = heightAt(t, bx, bz) + 0.3;
      const len = Math.hypot(bx - ax, bz - az);
      const lift = Math.min(12, 2 + len * 0.2) + f.n * 0.4;
      const steps = Math.max(8, Math.ceil(len / 2));
      let px = ax;
      let py = ya;
      let pz = az;
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        const x = ax + (bx - ax) * u;
        const z = az + (bz - az) * u;
        const y = ya + (yb - ya) * u + lift * 4 * u * (1 - u);
        // Brighter towards the destination, so the direction reads.
        seg(px, py, pz, x, y, z, f.item, 0.55 + 0.45 * u);
        px = x;
        py = y;
        pz = z;
      }
    }
    // Inputs asking with nothing on the way and no link: a stalk over the dock.
    const fed = linkFed(sim);
    for (const b of sim.state.buildings) {
      if (b.store) continue;
      let k = 0;
      for (const [item, s] of Object.entries(b.inp) as [ItemId, { n: number; r: number; since: number }][]) {
        if (s.since < 0 || s.r > 0 || fed.has(`${b.id}:${item}`)) continue;
        const [x, z] = dockPoint(b, 0);
        const y = heightAt(t, x, z);
        const ox = (k++ - 0.5) * 0.6;
        seg(x + ox, y, z, x + ox, y + 4, z, item, 1);
        seg(x + ox - 0.4, y + 4, z, x + ox + 0.4, y + 4, z, item, 1);
      }
    }
    const geo = this.lines.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setDrawRange(0, pos.length / 3);
  }
}
