// Model kit: bevelled boxes, cylinders and so on, coloured by palette role.
// Static parts are merged into one vertex-coloured mesh per model; moving
// parts are separate meshes that share role materials.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, type PaletteRole } from './palette';

export interface PartOpts {
  /** Bevel radius; 0 for a sharp box. */
  bevel?: number;
  rotY?: number;
  rotX?: number;
  rotZ?: number;
}

function prep(g: THREE.BufferGeometry, role: PaletteRole | number): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  const c = new THREE.Color(typeof role === 'number' ? role : PALETTE[role]);
  const n = out.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, o: PartOpts) {
  if (o.rotX) g.rotateX(o.rotX);
  if (o.rotZ) g.rotateZ(o.rotZ);
  if (o.rotY) g.rotateY(o.rotY);
  g.translate(x, y, z);
}

export function boxGeo(w: number, h: number, d: number, bevel = 0): THREE.BufferGeometry {
  const b = Math.min(bevel, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return b > 0.005 ? new RoundedBoxGeometry(w, h, d, 2, b) : new THREE.BoxGeometry(w, h, d);
}

/** Collects static parts; build() returns one merged mesh. */
export class Builder {
  private parts: THREE.BufferGeometry[] = [];

  /** Box with its base at y (not centred), like most things that sit on something. */
  box(role: PaletteRole | number, w: number, h: number, d: number, x: number, y: number, z: number, o: PartOpts = {}) {
    const g = boxGeo(w, h, d, o.bevel ?? 0.06);
    g.translate(0, h / 2, 0);
    place(g, x, y, z, o);
    this.parts.push(prep(g, role));
    return this;
  }

  cyl(role: PaletteRole | number, rTop: number, rBot: number, h: number, x: number, y: number, z: number, o: PartOpts & { segs?: number } = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, o.segs ?? 16);
    g.translate(0, h / 2, 0);
    place(g, x, y, z, o);
    this.parts.push(prep(g, role));
    return this;
  }

  geo(role: PaletteRole | number, g: THREE.BufferGeometry) {
    this.parts.push(prep(g, role));
    return this;
  }

  /** An open tray: thin base and four low rims. Base at y. */
  tray(role: PaletteRole, w: number, d: number, x: number, y: number, z: number, rim = 0.18) {
    const t = 0.06;
    this.box(role, w, t, d, x, y, z, { bevel: 0.02 });
    this.box(role, w, rim, t, x, y, z - d / 2 + t / 2, { bevel: 0.015 });
    this.box(role, w, rim, t, x, y, z + d / 2 - t / 2, { bevel: 0.015 });
    this.box(role, t, rim, d, x - w / 2 + t / 2, y, z, { bevel: 0.015 });
    this.box(role, t, rim, d, x + w / 2 - t / 2, y, z, { bevel: 0.015 });
    return this;
  }

  isEmpty() {
    return this.parts.length === 0;
  }

  build(material: THREE.Material = kitMaterial()): THREE.Mesh {
    const g = mergeGeometries(this.parts)!;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  geometry(): THREE.BufferGeometry {
    return mergeGeometries(this.parts)!;
  }
}

let kitMat: THREE.MeshStandardMaterial | null = null;
export function kitMaterial(): THREE.MeshStandardMaterial {
  return (kitMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }));
}

const roleMats = new Map<string, THREE.MeshStandardMaterial>();
/** Shared matte material for one palette role (for moving parts). */
export function roleMaterial(role: PaletteRole): THREE.MeshStandardMaterial {
  let m = roleMats.get(role);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE[role], roughness: 0.8, metalness: 0 });
    roleMats.set(role, m);
  }
  return m;
}

/** A per-instance emissive material (windows, lamps, glows). */
export function glowMaterial(base: PaletteRole, emissive: PaletteRole, intensity = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: PALETTE[base],
    emissive: PALETTE[emissive],
    emissiveIntensity: intensity,
    roughness: 0.6,
  });
}

/** A moving part: its own mesh with a role material. */
export function partMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
