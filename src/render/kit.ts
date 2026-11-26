// Model kit: bevelled boxes, cylinders and so on, coloured by palette role.
// Static parts are merged into one vertex-coloured mesh per model; moving
// parts are separate meshes that share role materials.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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

/** A closed outline with its corners rounded off by `r`. Points are [x, y], counter-clockwise. */
export function roundedShape(pts: [number, number][], r: number): THREE.Shape {
  const s = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, la * 0.45);
    const rb = Math.min(r, lb * 0.45);
    const inX = p[0] + ((a[0] - p[0]) / la) * ra;
    const inY = p[1] + ((a[1] - p[1]) / la) * ra;
    const outX = p[0] + ((b[0] - p[0]) / lb) * rb;
    const outY = p[1] + ((b[1] - p[1]) / lb) * rb;
    if (i === 0) s.moveTo(inX, inY);
    else s.lineTo(inX, inY);
    s.quadraticCurveTo(p[0], p[1], outX, outY);
  }
  s.closePath();
  return s;
}

/**
 * A side profile extruded into a solid, with soft edges.
 * axis 'x': points are [z, y], extruded across the width (X), centred.
 * axis 'z': points are [x, y], extruded along the depth (Z), centred.
 */
export function profileGeo(pts: [number, number][], length: number, axis: 'x' | 'z', bevel = 0.06, corner = 0.08): THREE.BufferGeometry {
  const b = Math.min(bevel, length / 2 - 0.001);
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(roundedShape(pts, corner), {
    depth: length - 2 * b,
    bevelEnabled: b > 0.004,
    bevelSize: b,
    bevelThickness: b,
    bevelOffset: -b,
    bevelSegments: 2,
    curveSegments: 5,
  });
  g.translate(0, 0, -(length - 2 * b) / 2);
  if (axis === 'x') g.rotateY(-Math.PI / 2);
  g.deleteAttribute('uv');
  g = toCreasedNormals(g, 0.7);
  return g;
}

/** A thin plate with rounded corners, lying in XY, facing +Z, centred. */
export function plateGeo(w: number, h: number, r: number, thick: number): THREE.BufferGeometry {
  const hw = w / 2, hh = h / 2;
  const g = new THREE.ExtrudeGeometry(roundedShape([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], r), {
    depth: thick, bevelEnabled: false, curveSegments: 6,
  });
  g.translate(0, 0, -thick / 2);
  g.deleteAttribute('uv');
  return g;
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

  geo(role: PaletteRole | number, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, o: PartOpts = {}) {
    place(g, x, y, z, o);
    this.parts.push(prep(g, role));
    return this;
  }

  /** A side profile extruded into a solid; see profileGeo. */
  profile(role: PaletteRole | number, pts: [number, number][], length: number, axis: 'x' | 'z', x: number, y: number, z: number, o: PartOpts & { corner?: number } = {}) {
    const g = profileGeo(pts, length, axis, o.bevel ?? 0.06, o.corner ?? 0.08);
    place(g, x, y, z, o);
    this.parts.push(prep(g, role));
    return this;
  }

  /**
   * An open tray: dark floor, pale rims, and a coloured lip along the front
   * (+Z) rim, where goods cross. Base at y.
   */
  tray(w: number, d: number, x: number, y: number, z: number, rim = 0.2, lip: PaletteRole | null = 'logistics') {
    const t = 0.09;
    this.box('trayFloor', w, 0.05, d, x, y, z, { bevel: 0.02 });
    this.box('hull', w, rim, t, x, y, z - d / 2 + t / 2, { bevel: 0.03 });
    this.box(lip ?? 'hull', w, rim, t, x, y, z + d / 2 - t / 2, { bevel: 0.03 });
    this.box('hull', t, rim, d, x - w / 2 + t / 2, y, z, { bevel: 0.03 });
    this.box('hull', t, rim, d, x + w / 2 - t / 2, y, z, { bevel: 0.03 });
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
