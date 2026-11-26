// Model kit. Hard-edged, kit-bashed industrial hardware: chamfered blocks
// whose edges show worn paint, panelled walls with visible seams, pipes,
// trusses, vents, tanks. Static parts merge into one mesh per model and share
// one material, which adds grime, streaks, dust and edge wear in the shader.
//
// Every vertex carries: colour (paint), and `surf` = (wear, metal). Wear marks
// chamfers and rims, where paint chips to bare metal.

import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, type PaletteRole } from './palette';

export type Role = PaletteRole | number;

export interface PartOpts {
  /** Chamfer size (boxes, cylinders); 0 for sharp. */
  c?: number;
  rotY?: number;
  rotX?: number;
  rotZ?: number;
  /** Brightness multiplier on the paint, for panel-to-panel variation. */
  tint?: number;
  /** 0 painted, 1 bare metal. */
  metal?: number;
  segs?: number;
}

/** A small deterministic generator for greeble placement. */
export class Rand {
  constructor(private s: number) {}
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) | 0;
    return ((this.s >>> 8) & 0xffffff) / 0x1000000;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  pick<T>(list: T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// --- Raw geometry: positions, flat normals, wear ---------------------------

class Raw {
  pos: number[] = [];
  nor: number[] = [];
  wear: number[] = [];

  tri(a: number[], b: number[], c: number[], wear: number, outwardFrom?: number[]) {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (outwardFrom) {
      const cx = (a[0] + b[0] + c[0]) / 3 - outwardFrom[0];
      const cy = (a[1] + b[1] + c[1]) / 3 - outwardFrom[1];
      const cz = (a[2] + b[2] + c[2]) / 3 - outwardFrom[2];
      if (nx * cx + ny * cy + nz * cz < 0) {
        [b, c] = [c, b];
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
    }
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) {
      this.nor.push(nx, ny, nz);
      this.wear.push(wear);
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], wear: number, outwardFrom?: number[]) {
    this.tri(a, b, c, wear, outwardFrom);
    this.tri(a, c, d, wear, outwardFrom);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('wear', new THREE.Float32BufferAttribute(this.wear, 1));
    return g;
  }
}

/** A box centred on the origin with chamfered edges. Chamfers are marked as wear. */
export function boxGeo(w: number, h: number, d: number, c = 0.035): THREE.BufferGeometry {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  c = Math.max(0, Math.min(c, hx * 0.9, hy * 0.9, hz * 0.9));
  const r = new Raw();
  const O = [0, 0, 0];
  const half = [hx, hy, hz];
  // Point on face `a` (axis index) at corner signs s[0..2].
  const P = (a: number, s: number[]) => [0, 1, 2].map((i) => s[i] * (i === a ? half[i] : half[i] - c));
  const signs = [-1, 1];
  // Faces.
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, e = (a + 2) % 3;
    for (const sa of signs) {
      const s = (sb: number, se: number) => {
        const v = [0, 0, 0];
        v[a] = sa;
        v[b] = sb;
        v[e] = se;
        return P(a, v);
      };
      r.quad(s(-1, -1), s(1, -1), s(1, 1), s(-1, 1), 0, O);
    }
  }
  if (c > 0) {
    // Edge chamfers: between face a and face b, running along e.
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, e = (a + 2) % 3;
      for (const sa of signs) for (const sb of signs) {
        const s = (se: number) => {
          const v = [0, 0, 0];
          v[a] = sa;
          v[b] = sb;
          v[e] = se;
          return v;
        };
        r.quad(P(a, s(-1)), P(a, s(1)), P(b, s(1)), P(b, s(-1)), 1, O);
      }
    }
    // Corners.
    for (const sx of signs) for (const sy of signs) for (const sz of signs) {
      const s = [sx, sy, sz];
      r.tri(P(0, s), P(1, s), P(2, s), 1, O);
    }
  }
  return r.build();
}

/**
 * A solid of revolution about Y from a profile of [radius, y, wear?] points,
 * bottom to top; `wear` marks the segment that starts at that point. Smooth
 * around the axis, hard between profile segments. Open ends are capped.
 */
export function latheGeo(profile: [number, number, number?][], segs = 16): THREE.BufferGeometry {
  const pts = profile.slice();
  if (pts[0][0] > 1e-4) pts.unshift([0, pts[0][1], 0]);
  if (pts[pts.length - 1][0] > 1e-4) pts.push([0, pts[pts.length - 1][1], 0]);
  const pos: number[] = [], nor: number[] = [], wear: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const [r0, y0] = pts[k];
    const [r1, y1] = pts[k + 1];
    const w = pts[k][2] ?? 0;
    // Outward normal of the segment in the (r, y) plane.
    let nr = y1 - y0, ny = -(r1 - r0);
    const l = Math.hypot(nr, ny) || 1;
    nr /= l;
    ny /= l;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const v = (rr: number, y: number, cc: number, ss: number) => [rr * cc, y, rr * ss];
      const n0 = [nr * c0, ny, nr * s0], n1 = [nr * c1, ny, nr * s1];
      const A = v(r0, y0, c0, s0), B = v(r1, y1, c0, s0), C = v(r1, y1, c1, s1), D = v(r0, y0, c1, s1);
      const push = (p: number[], n: number[]) => {
        pos.push(...p);
        nor.push(...n);
        wear.push(w);
      };
      if (r1 > 1e-4) {
        push(A, n0);
        push(B, n0);
        push(C, n1);
      }
      if (r0 > 1e-4) {
        push(A, n0);
        push(C, n1);
        push(D, n1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('wear', new THREE.Float32BufferAttribute(wear, 1));
  return g;
}

/** A cylinder (or cone frustum) with its base at y = 0 and chamfered rims. */
export function cylGeo(rTop: number, rBot: number, h: number, segs = 16, c = 0.03): THREE.BufferGeometry {
  c = Math.max(0, Math.min(c, h * 0.3, rTop * 0.6, rBot * 0.6));
  if (c <= 0) return latheGeo([[rBot, 0], [rTop, h]], segs);
  return latheGeo([[rBot - c, 0, 1], [rBot, c, 0], [rTop, h - c, 1], [rTop - c, h]], segs);
}

/** A closed outline with its corners rounded off by `r`. Points are [x, y]. */
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
    if (r > 0.001) s.quadraticCurveTo(p[0], p[1], outX, outY);
    else s.lineTo(outX, outY);
  }
  s.closePath();
  return s;
}

/**
 * A side profile extruded into a solid with hard edges.
 * axis 'x': points are [z, y], extruded across the width (X), centred.
 * axis 'z': points are [x, y], extruded along the depth (Z), centred.
 */
export function profileGeo(pts: [number, number][], length: number, axis: 'x' | 'z', corner = 0): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(roundedShape(pts, corner), {
    depth: length,
    bevelEnabled: false,
    curveSegments: 4,
  });
  g.translate(0, 0, -length / 2);
  if (axis === 'x') g.rotateY(-Math.PI / 2);
  g.deleteAttribute('uv');
  g = toCreasedNormals(g, 0.5);
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

function prep(g: THREE.BufferGeometry, role: Role, o: PartOpts): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'wear') out.deleteAttribute(k);
  const c = new THREE.Color(typeof role === 'number' ? role : PALETTE[role]);
  if (o.tint) c.multiplyScalar(o.tint);
  const n = out.attributes.position.count;
  const col = new Float32Array(n * 3);
  const surf = new Float32Array(n * 2);
  const wear = out.attributes.wear as THREE.BufferAttribute | undefined;
  const metal = o.metal ?? 0;
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    surf[i * 2] = wear ? wear.getX(i) : 0;
    surf[i * 2 + 1] = metal;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('surf', new THREE.BufferAttribute(surf, 2));
  if (wear) out.deleteAttribute('wear');
  return out;
}

export type Face = 'front' | 'back' | 'left' | 'right' | 'top';
export type V3 = [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

/** Collects static parts; build() returns one merged mesh. */
export class Builder {
  private parts: THREE.BufferGeometry[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  /** Pass another builder to work in its frames: `on` and `at` then apply to both. */
  constructor(share?: Builder) {
    if (share) this.stack = share.stack;
  }

  private add(g: THREE.BufferGeometry, role: Role, x: number, y: number, z: number, o: PartOpts) {
    if (o.rotX) g.rotateX(o.rotX);
    if (o.rotZ) g.rotateZ(o.rotZ);
    if (o.rotY) g.rotateY(o.rotY);
    g.translate(x, y, z);
    g.applyMatrix4(this.stack[this.stack.length - 1]);
    this.parts.push(prep(g, role, o));
    return this;
  }

  /**
   * Work in a face's own frame: x across the wall, y up it, z out of it,
   * with the origin at (x, y, z). For 'top', y runs towards the back.
   */
  on(face: Face, x: number, y: number, z: number, fn: () => void) {
    const m = new THREE.Matrix4();
    if (face === 'back') m.makeRotationY(Math.PI);
    else if (face === 'right') m.makeRotationY(Math.PI / 2);
    else if (face === 'left') m.makeRotationY(-Math.PI / 2);
    else if (face === 'top') m.makeRotationX(-Math.PI / 2);
    m.setPosition(x, y, z);
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(m));
    fn();
    this.stack.pop();
    return this;
  }

  /** Work in an arbitrary frame. */
  at(m: THREE.Matrix4, fn: () => void) {
    this.stack.push(this.stack[this.stack.length - 1].clone().multiply(m));
    fn();
    this.stack.pop();
    return this;
  }

  /** Chamfered box with its base at y. */
  box(role: Role, w: number, h: number, d: number, x: number, y: number, z: number, o: PartOpts = {}) {
    const g = boxGeo(w, h, d, o.c ?? 0.035);
    g.translate(0, h / 2, 0);
    return this.add(g, role, x, y, z, o);
  }

  /** Cylinder or frustum with its base at y. */
  cyl(role: Role, rTop: number, rBot: number, h: number, x: number, y: number, z: number, o: PartOpts = {}) {
    return this.add(cylGeo(rTop, rBot, h, o.segs ?? 16, o.c ?? 0.03), role, x, y, z, o);
  }

  /** Solid of revolution; see latheGeo. */
  lathe(role: Role, profile: [number, number, number?][], x: number, y: number, z: number, o: PartOpts = {}) {
    return this.add(latheGeo(profile, o.segs ?? 20), role, x, y, z, o);
  }

  geo(role: Role, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, o: PartOpts = {}) {
    return this.add(g, role, x, y, z, o);
  }

  profile(role: Role, pts: [number, number][], length: number, axis: 'x' | 'z', x: number, y: number, z: number, o: PartOpts & { corner?: number } = {}) {
    return this.add(profileGeo(pts, length, axis, o.corner ?? 0), role, x, y, z, o);
  }

  /** A straight member between two points: square section by default, round if `round`. */
  beam(role: Role, a: V3, b: V3, size: number, o: PartOpts & { round?: boolean } = {}) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    if (len < 1e-4) return this;
    const g = o.round ? cylGeo(size / 2, size / 2, len, o.segs ?? 8, 0) : boxGeo(size, len, size, o.c ?? 0.012);
    if (!o.round) g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, vb.clone().sub(va).normalize());
    g.applyQuaternion(q);
    return this.add(g, role, a[0], a[1], a[2], { tint: o.tint, metal: o.metal });
  }

  /** A pipe through the given points, with ball joints at bends and flanges at both ends. */
  pipe(role: Role, pts: V3[], r: number, o: PartOpts & { flanges?: boolean } = {}) {
    for (let i = 0; i < pts.length - 1; i++) this.beam(role, pts[i], pts[i + 1], r * 2, { round: true, segs: 10, tint: o.tint, metal: o.metal });
    for (let i = 1; i < pts.length - 1; i++) this.add(new THREE.SphereGeometry(r * 1.12, 10, 8), role, ...pts[i], { tint: o.tint, metal: o.metal });
    if (o.flanges !== false) {
      for (const [p, q] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]] as [V3, V3][]) {
        const dir = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
        const g = cylGeo(r * 1.5, r * 1.5, r * 0.7, 10, 0.01);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
        this.add(g, role, p[0] + dir.x * r * 0.3, p[1] + dir.y * r * 0.3, p[2] + dir.z * r * 0.3, { tint: (o.tint ?? 1) * 0.85, metal: o.metal });
      }
    }
    return this;
  }

  /**
   * Raised plates covering a w × h area in the current frame (x across,
   * y up from 0, proud of z = 0), with seams between them.
   */
  panels(role: Role, w: number, h: number, cols: number, rows: number, rng: Rand, o: { gap?: number; t?: number; x?: number; y?: number; metal?: number } = {}) {
    const gap = o.gap ?? 0.035, t = o.t ?? 0.04;
    const cw = w / cols, ch = h / rows;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const tint = rng.range(0.88, 1.06);
        const g = boxGeo(cw - gap, ch - gap, t * 2, Math.min(0.02, t * 0.6));
        this.add(g, role, (o.x ?? 0) - w / 2 + cw * (i + 0.5), (o.y ?? 0) + ch * (j + 0.5), 0, { tint, metal: o.metal });
      }
    }
    return this;
  }

  /**
   * An armoured block: a dark core clad in panels on its four walls and roof,
   * so every face shows seams. Base at y; centred on (x, z).
   */
  hull(role: Role, w: number, h: number, d: number, x: number, y: number, z: number, rng: Rand, o: { cell?: number; roof?: Role | null; seam?: Role } = {}) {
    const cell = o.cell ?? 1.0;
    const t = 0.045;
    this.box(o.seam ?? 'seam', w - t * 2, h - t, d - t * 2, x, y, z, { c: 0 });
    const cx = (len: number) => Math.max(1, Math.round(len / cell));
    const rows = Math.max(1, Math.round(h / (cell * 0.85)));
    this.on('front', x, y, z + d / 2 - t, () => this.panels(role, w, h, cx(w), rows, rng));
    this.on('back', x, y, z - d / 2 + t, () => this.panels(role, w, h, cx(w), rows, rng));
    this.on('right', x + w / 2 - t, y, z, () => this.panels(role, d - t * 2, h, cx(d), rows, rng));
    this.on('left', x - w / 2 + t, y, z, () => this.panels(role, d - t * 2, h, cx(d), rows, rng));
    if (o.roof !== null) this.on('top', x, y + h - t, z + d / 2, () => this.panels(o.roof ?? role, w, d, cx(w), cx(d), rng));
    return this;
  }

  /** A louvred vent in the current frame, centred on (x, y) with its bottom at y. */
  vent(w: number, h: number, x: number, y: number, slats = 4) {
    this.box('structure', w, h, 0.08, x, y, 0.0, { c: 0.015 });
    for (let k = 0; k < slats; k++) {
      this.box('hullDark', w - 0.1, 0.03, 0.09, x, y + (h / (slats + 1)) * (k + 1) - 0.015, 0.03, { c: 0.008, rotX: 0.5 });
    }
    return this;
  }

  /** Vertical ribs along a wall in the current frame: stiffeners, columns. */
  ribs(role: Role, w: number, h: number, n: number, size = 0.1, depth = 0.1) {
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? 0 : -w / 2 + (w / (n - 1)) * k;
      this.box(role, size, h, depth, x, 0, depth / 2, { c: 0.012 });
    }
    return this;
  }

  /** A handrail along a path of points (posts at each point, two rails). */
  railing(role: Role, pts: V3[], h = 0.5) {
    const s = 0.035;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      this.beam(role, p, [p[0], p[1] + h, p[2]], s);
      if (i > 0) {
        const q = pts[i - 1];
        this.beam(role, [q[0], q[1] + h, q[2]], [p[0], p[1] + h, p[2]], s);
        this.beam(role, [q[0], q[1] + h * 0.5, q[2]], [p[0], p[1] + h * 0.5, p[2]], s * 0.8);
      }
    }
    return this;
  }

  /** A ladder up a wall in the current frame, from y = 0. */
  ladder(role: Role, h: number, x = 0) {
    const w = 0.32;
    this.box(role, 0.035, h, 0.035, x - w / 2, 0, 0.09, { c: 0 });
    this.box(role, 0.035, h, 0.035, x + w / 2, 0, 0.09, { c: 0 });
    for (let y = 0.2; y < h - 0.05; y += 0.24) this.box(role, w, 0.025, 0.025, x, y, 0.09, { c: 0 });
    return this;
  }

  /** Alternating yellow and dark blocks along X in the current frame: a hazard edge. */
  hazard(len: number, h: number, d: number, x: number, y: number, z: number, pitch = 0.3) {
    const n = Math.max(2, Math.round(len / pitch));
    const seg = len / n;
    for (let k = 0; k < n; k++) {
      this.box(k % 2 ? 'structure' : 'hazard', seg, h, d, x - len / 2 + seg * (k + 0.5), y, z, { c: 0.006 });
    }
    return this;
  }

  /** A vertical tank: straight shell, domed ends, two bands. Base at y. */
  tank(role: Role, r: number, h: number, x: number, y: number, z: number, o: PartOpts = {}) {
    const d = r * 0.45;
    this.lathe(role, [[r * 0.55, 0], [r, d * 0.6], [r, h - d], [r * 0.8, h - d * 0.35], [r * 0.4, h]], x, y, z, { segs: 16, ...o });
    for (const f of [0.3, 0.7]) this.cyl('structure', r + 0.025, r + 0.025, 0.06, x, y + h * f, z, { segs: 16, c: 0.01 });
    return this;
  }

  /** An open tray: dark floor, steel rims, a painted lip along the front (+Z) rim. Base at y. */
  tray(w: number, d: number, x: number, y: number, z: number, rim = 0.2, lip: PaletteRole | null = 'logistics') {
    const t = 0.07;
    this.box('trayFloor', w, 0.05, d, x, y, z, { c: 0.01 });
    this.box('hullDark', w, rim, t, x, y, z - d / 2 + t / 2, { c: 0.02 });
    this.box(lip ?? 'hullDark', w, rim, t, x, y, z + d / 2 - t / 2, { c: 0.02 });
    this.box('hullDark', t, rim, d, x - w / 2 + t / 2, y, z, { c: 0.02 });
    this.box('hullDark', t, rim, d, x + w / 2 - t / 2, y, z, { c: 0.02 });
    return this;
  }

  isEmpty() {
    return this.parts.length === 0;
  }

  build(material: THREE.Material = kitMaterial()): THREE.Mesh {
    const g = this.geometry();
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

// --- The grime shader ------------------------------------------------------

export const NOISE_GLSL = /* glsl */ `
float kHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float kNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(kHash(i), kHash(i + vec3(1,0,0)), f.x), mix(kHash(i + vec3(0,1,0)), kHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(kHash(i + vec3(0,0,1)), kHash(i + vec3(1,0,1)), f.x), mix(kHash(i + vec3(0,1,1)), kHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

/** Adds grime, streaks, ground dirt, dust and edge wear to a vertex-coloured standard material. */
export function weather(mat: THREE.MeshStandardMaterial, amount = 1): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDust = { value: new THREE.Color(PALETTE.dust) };
    shader.uniforms.uBare = { value: new THREE.Color(PALETTE.bareMetal) };
    shader.uniforms.uGrime = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 surf;
varying vec2 vSurf;
varying vec3 vObj;
varying vec3 vObjN;
varying float vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSurf = surf;
vObj = position;
vObjN = normal;
#ifdef USE_INSTANCING
vSeed = 0.0;
#else
vSeed = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.71;
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uDust;
uniform vec3 uBare;
uniform float uGrime;
varying vec2 vSurf;
varying vec3 vObj;
varying vec3 vObjN;
varying float vSeed;
${NOISE_GLSL}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
{
  vec3 p = vObj + vec3(vSeed, 0.0, vSeed * 1.7);
  float nBig = kNoise(p * 0.9);
  float nMid = kNoise(p * 3.7);
  float nFine = kNoise(p * 19.0);
  vec3 nObj = normalize(vObjN);
  float wall = 1.0 - abs(nObj.y);
  // Uneven, faded paint.
  diffuseColor.rgb *= (0.9 + 0.2 * nBig) * (0.95 + 0.1 * nFine);
  // Streaks running down walls: grime and a little rust.
  float streak = kNoise(vec3(p.x * 4.5, p.y * 0.55, p.z * 4.5));
  float s = smoothstep(0.52, 0.82, streak) * wall * uGrime;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.58, 0.47, 0.4), s * 0.6);
  // Soot and oil in patches.
  float soot = smoothstep(0.62, 0.9, nMid * 0.6 + nBig * 0.5) * uGrime;
  diffuseColor.rgb *= 1.0 - 0.3 * soot;
  // Dirt kicked up from the ground, dust settled on top.
  float dirt = smoothstep(0.85, 0.0, vObj.y) * (0.45 + 0.55 * nMid) * uGrime;
  diffuseColor.rgb = mix(diffuseColor.rgb, uDust, dirt * 0.6);
  float topDust = smoothstep(0.6, 1.0, nObj.y) * (0.2 + 0.5 * nBig) * uGrime;
  diffuseColor.rgb = mix(diffuseColor.rgb, uDust, topDust * 0.3);
  // Paint chipped to bare metal along edges.
  float wearMask = smoothstep(0.45, 0.7, vSurf.x * (0.35 + 1.1 * kNoise(p * 6.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb, uBare, wearMask * 0.85);
  float metal = clamp(vSurf.y * (1.0 - dirt) * (1.0 - topDust), 0.0, 1.0);
  metalnessFactor = mix(metal, 0.9, wearMask);
  roughnessFactor = mix(clamp(roughnessFactor * (0.8 + 0.4 * nFine) - 0.35 * vSurf.y, 0.25, 1.0), 0.42, wearMask);
}`);
  };
  return mat;
}

let kitMat: THREE.MeshStandardMaterial | null = null;
export function kitMaterial(): THREE.MeshStandardMaterial {
  return (kitMat ??= weather(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 })));
}

const roleMats = new Map<string, THREE.MeshStandardMaterial>();
/** Shared material for one palette role (for moving parts). */
export function roleMaterial(role: PaletteRole, metal = 0): THREE.MeshStandardMaterial {
  const key = role + ':' + metal;
  let m = roleMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: PALETTE[role], roughness: metal ? 0.42 : 0.8, metalness: metal });
    roleMats.set(key, m);
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

/** A moving part: its own mesh. */
export function partMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A moving part built from kit pieces, sharing the weathered kit material. */
export function kitPart(build: (b: Builder) => void): THREE.Mesh {
  const b = new Builder();
  build(b);
  return b.build();
}
