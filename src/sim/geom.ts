// 2D oriented rectangles on the XZ plane. Rotation follows three.js
// rotation.y, so the renderer can use the same angle directly.

export interface OBB {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rot: number;
}

/** Local (lx, lz) in a frame at (x, z) rotated by rot → world [x, z]. */
export function toWorld(x: number, z: number, rot: number, lx: number, lz: number): [number, number] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

export function toLocal(x: number, z: number, rot: number, wx: number, wz: number): [number, number] {
  const dx = wx - x;
  const dz = wz - z;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [dx * c - dz * s, dx * s + dz * c];
}

export function corners(o: OBB): [number, number][] {
  return [
    toWorld(o.cx, o.cz, o.rot, -o.hx, -o.hz),
    toWorld(o.cx, o.cz, o.rot, o.hx, -o.hz),
    toWorld(o.cx, o.cz, o.rot, o.hx, o.hz),
    toWorld(o.cx, o.cz, o.rot, -o.hx, o.hz),
  ];
}

export function inflate(o: OBB, r: number): OBB {
  return { ...o, hx: o.hx + r, hz: o.hz + r };
}

export function containsPoint(o: OBB, x: number, z: number): boolean {
  const [lx, lz] = toLocal(o.cx, o.cz, o.rot, x, z);
  return Math.abs(lx) <= o.hx && Math.abs(lz) <= o.hz;
}

/** Separating axis test. Touching (penetration below eps) is not overlap. */
export function obbOverlap(a: OBB, b: OBB, eps = 0.02): boolean {
  const axes: [number, number][] = [
    [Math.cos(a.rot), -Math.sin(a.rot)],
    [Math.sin(a.rot), Math.cos(a.rot)],
    [Math.cos(b.rot), -Math.sin(b.rot)],
    [Math.sin(b.rot), Math.cos(b.rot)],
  ];
  const project = (o: OBB, ax: number, az: number) => {
    const ux: [number, number] = [Math.cos(o.rot), -Math.sin(o.rot)];
    const uz: [number, number] = [Math.sin(o.rot), Math.cos(o.rot)];
    const c = o.cx * ax + o.cz * az;
    const r = o.hx * Math.abs(ux[0] * ax + ux[1] * az) + o.hz * Math.abs(uz[0] * ax + uz[1] * az);
    return [c - r, c + r];
  };
  for (const [ax, az] of axes) {
    const [a0, a1] = project(a, ax, az);
    const [b0, b1] = project(b, ax, az);
    if (Math.min(a1, b1) - Math.max(a0, b0) <= eps) return false;
  }
  return true;
}

export function aabb(o: OBB): { x0: number; z0: number; x1: number; z1: number } {
  const c = Math.abs(Math.cos(o.rot));
  const s = Math.abs(Math.sin(o.rot));
  const ex = o.hx * c + o.hz * s;
  const ez = o.hx * s + o.hz * c;
  return { x0: o.cx - ex, z0: o.cz - ez, x1: o.cx + ex, z1: o.cz + ez };
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
