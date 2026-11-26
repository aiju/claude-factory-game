// Dock aprons: painted outline and hazard chevrons, draped over the ground.

import * as THREE from 'three';
import { BUILDINGS, type BuildingTypeId } from '../data/buildings';
import { PARKING } from '../data/tunables';
import { toWorld } from '../sim/geom';
import { heightAt, type Terrain } from '../sim/terrain';
import { PALETTE, type PaletteRole } from './palette';

type V2 = [number, number];

class Drape {
  pos: number[] = [];
  col: number[] = [];
  constructor(
    private t: Terrain,
    private x: number,
    private z: number,
    private rot: number,
    private lift = 0.05,
  ) {}

  /** A local-frame quad (corners in order), subdivided so it follows the ground. */
  quad(a: V2, b: V2, c: V2, d: V2, role: PaletteRole) {
    const len = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(d[0] - a[0], d[1] - a[1]));
    const n = Math.max(1, Math.ceil(len / 0.6));
    const m = Math.max(1, Math.ceil(Math.hypot(d[0] - a[0], d[1] - a[1]) / 0.6));
    const col = new THREE.Color(PALETTE[role]);
    const at = (u: number, v: number): [number, number, number] => {
      const lx = (a[0] * (1 - u) + b[0] * u) * (1 - v) + (d[0] * (1 - u) + c[0] * u) * v;
      const lz = (a[1] * (1 - u) + b[1] * u) * (1 - v) + (d[1] * (1 - u) + c[1] * u) * v;
      const [wx, wz] = toWorld(this.x, this.z, this.rot, lx, lz);
      return [wx, heightAt(this.t, wx, wz) + this.lift, wz];
    };
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < n; i++) {
        const p00 = at(i / n, j / m);
        const p10 = at((i + 1) / n, j / m);
        const p01 = at(i / n, (j + 1) / m);
        const p11 = at((i + 1) / n, (j + 1) / m);
        for (const p of [p00, p01, p10, p10, p01, p11]) {
          this.pos.push(...p);
          this.col.push(col.r, col.g, col.b);
        }
      }
    }
  }

  rect(x0: number, z0: number, x1: number, z1: number, role: PaletteRole) {
    this.quad([x0, z0], [x1, z0], [x1, z1], [x0, z1], role);
  }

  build(material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}

let paintMat: THREE.MeshStandardMaterial | null = null;
export function paintMaterial(): THREE.MeshStandardMaterial {
  return (paintMat ??= new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
}

export function buildDockMesh(t: Terrain, type: BuildingTypeId, x: number, z: number, rot: number, material?: THREE.Material): THREE.Mesh | null {
  const def = BUILDINGS[type];
  if (!def.dock) return null;
  const dr = new Drape(t, x, z, rot);
  const hw = def.dock.w / 2;
  const z0 = def.d / 2;
  const z1 = def.d / 2 + def.dock.d;
  // Quiet paint: thin off-white corner brackets, and a few small chevrons
  // pointing at the building. Never louder than the building itself.
  const s = 0.07;
  const arm = Math.min(0.9, def.dock.w / 4);
  for (const sx of [-1, 1]) {
    const xo = sx * hw;
    const xi = sx * (hw - s);
    dr.rect(Math.min(xo, xi), z1 - arm, Math.max(xo, xi), z1, 'roadMark');
    dr.rect(Math.min(xo, sx * (hw - arm)), z1 - s, Math.max(xo, sx * (hw - arm)), z1, 'roadMark');
    dr.rect(Math.min(xo, xi), z0 + 0.15, Math.max(xo, xi), z0 + 0.15 + arm * 0.6, 'roadMark');
  }
  const cw = 0.46;
  const pitch = 0.75;
  const count = Math.min(3, Math.max(1, Math.floor((def.dock.w - 1.5) / pitch)));
  const span = (count - 1) * pitch;
  const zc = z1 - 0.45;
  const a = 0.1;
  // A deep apron (the hub's) has no single approach line to point along.
  for (let k = 0; k < (def.dock.d <= 4 ? count : 0); k++) {
    const cx = -span / 2 + k * pitch;
    dr.quad([cx - a / 2, zc - 0.15], [cx + a / 2, zc - 0.15], [cx + cw / 2 + a / 2, zc + 0.15], [cx + cw / 2 - a / 2, zc + 0.15], 'hazard');
    dr.quad([cx - a / 2, zc - 0.15], [cx + a / 2, zc - 0.15], [cx - cw / 2 + a / 2, zc + 0.15], [cx - cw / 2 - a / 2, zc + 0.15], 'hazard');
  }
  if (type === 'hub') {
    // Parking bay lines along the front row.
    const P = PARKING;
    for (let k = 0; k <= P.front; k++) {
      const lx = (k - P.front / 2) * P.spacing;
      dr.rect(lx - 0.035, z0 + 0.25, lx + 0.035, z0 + P.rowZ * 2 - 0.1, 'roadMark');
    }
  }
  return dr.build(material ?? paintMaterial());
}

/** A thin outline around a building's body, on the ground (selection, demolish hover). */
export function buildOutline(t: Terrain, type: BuildingTypeId, x: number, z: number, rot: number, role: PaletteRole): THREE.Mesh {
  const def = BUILDINGS[type];
  const dr = new Drape(t, x, z, rot, 0.07);
  const o = 0.35;
  const s = 0.16;
  const hw = def.w / 2 + o;
  const hd = def.d / 2 + o;
  dr.rect(-hw, -hd, hw, -hd + s, role);
  dr.rect(-hw, hd - s, hw, hd, role);
  dr.rect(-hw, -hd + s, -hw + s, hd - s, role);
  dr.rect(hw - s, -hd + s, hw, hd - s, role);
  return dr.build(paintMaterial());
}
