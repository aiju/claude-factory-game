// Building meshes, composed from the model kit. Local frame: +Z is the front
// (the dock side), Y up, origin at ground level.
//
// Working industrial plant: steel frames, clad volumes with panel seams,
// pipework, tanks, ladders and railings, on a stained concrete slab with a
// hazard-striped dock edge. Each building has one moving part that shows it
// is working. Accents are functional: orange where goods cross, cyan for
// powered lights, yellow and black on things that move.

import * as THREE from 'three';
import { BUILDINGS, type BuildingTypeId } from '../data/buildings';
import { Builder, Rand, glowMaterial, kitMaterial, kitPart, partMesh, roleMaterial, type V3 } from './kit';

/** Height of the concrete slab above the ground at the building's origin. */
export const PAD_TOP = 0.15;
const T = PAD_TOP;

export interface TraySpot {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
}

export interface BuildingModel {
  root: THREE.Group;
  /** The merged static mesh; used for picking. */
  body: THREE.Mesh;
  inTrays: TraySpot[];
  outTrays: TraySpot[];
  /** Hub only: one bin per item, in ITEM_IDS order. */
  bins: TraySpot[];
  /** Amber pulse outline per input tray. */
  trayPulse: THREE.Mesh[];
  windows: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  /** Moving parts, by name: piston, ram, dish. */
  parts: Record<string, THREE.Object3D>;
  /** Furnace mouth glow (smelter). */
  glow: THREE.MeshStandardMaterial | null;
  /** Where smoke leaves, local, and what sort. */
  smokeAt: THREE.Vector3 | null;
  smokeKind?: 'stack' | 'exhaust';
}

/** Concrete slab with expansion joints and a hazard-striped front edge. */
function pad(st: Builder, w: number, d: number) {
  st.box('pad', w, 1.6 + T, d, 0, -1.6, 0, { c: 0.03 });
  const nx = Math.max(1, Math.round(w / 2.2));
  const nz = Math.max(1, Math.round(d / 2.2));
  for (let k = 1; k < nx; k++) st.box('padSeam', 0.04, 0.012, d - 0.08, -w / 2 + (w / nx) * k, T - 0.006, 0, { c: 0 });
  for (let k = 1; k < nz; k++) st.box('padSeam', w - 0.08, 0.012, 0.04, 0, T - 0.006, -d / 2 + (d / nz) * k, { c: 0 });
  st.hazard(w - 0.2, 0.014, 0.16, 0, T - 0.006, d / 2 - 0.13, 0.32);
}

/** Lit panels on a wall, in the current frame. */
function lit(wb: Builder, w: number, h: number, x: number, y: number, z = 0.05) {
  wb.box('structure', w, h, 0.04, x, y, z, { c: 0 });
}

/** A status beacon on a short post: the amber lamp. */
function beacon(st: Builder, x: number, y: number, z: number): THREE.Mesh {
  st.cyl('structure', 0.045, 0.045, 0.4, x, y, z, { segs: 8, c: 0 });
  st.cyl('hullDark', 0.14, 0.16, 0.08, x, y + 0.4, z, { segs: 10, c: 0.015 });
  const bulb = partMesh(new THREE.CylinderGeometry(0.11, 0.12, 0.2, 10), glowMaterial('hullSecondary', 'hazard', 0));
  bulb.position.set(x, y + 0.58, z);
  bulb.castShadow = false;
  st.cyl('structure', 0.13, 0.13, 0.03, x, y + 0.68, z, { segs: 10, c: 0 });
  return bulb;
}

const TRAY_RIM = 0.2;

function pulseRim(t: TraySpot): THREE.Mesh {
  const b = new Builder();
  const r = 0.09;
  const h = 0.05;
  const y = t.y + TRAY_RIM + 0.01;
  b.box('hazard', t.w + 0.06, h, r, t.x, y, t.z - t.d / 2 + r / 2, { c: 0 });
  b.box('hazard', t.w + 0.06, h, r, t.x, y, t.z + t.d / 2 - r / 2, { c: 0 });
  b.box('hazard', r, h, t.d, t.x - t.w / 2 + r / 2, y, t.z, { c: 0 });
  b.box('hazard', r, h, t.d, t.x + t.w / 2 - r / 2, y, t.z, { c: 0 });
  const m = new THREE.Mesh(b.geometry(), glowMaterial('hazard', 'hazard', 0));
  m.visible = false;
  return m;
}

function finish(
  type: BuildingTypeId,
  st: Builder,
  wb: Builder,
  bulb: THREE.Mesh,
  extra: Partial<BuildingModel>,
): BuildingModel {
  const root = new THREE.Group();
  const body = st.build(kitMaterial());
  body.userData.kind = 'building';
  root.add(body);
  const windows = glowMaterial('structure', 'power', 0.9);
  if (!wb.isEmpty()) {
    const w = new THREE.Mesh(wb.geometry(), windows);
    w.castShadow = false;
    root.add(w);
  }
  root.add(bulb);
  const inTrays = extra.inTrays ?? [];
  const trayPulse = inTrays.map(pulseRim);
  for (const p of trayPulse) root.add(p);
  for (const p of Object.values(extra.parts ?? {})) root.add(p);
  root.userData.type = type;
  return {
    root,
    body,
    inTrays,
    outTrays: extra.outTrays ?? [],
    bins: extra.bins ?? [],
    trayPulse,
    windows,
    lamp: bulb.material as THREE.MeshStandardMaterial,
    parts: extra.parts ?? {},
    glow: extra.glow ?? null,
    smokeAt: extra.smokeAt ?? null,
    smokeKind: extra.smokeKind,
  };
}

function trays(st: Builder, list: TraySpot[]) {
  for (const t of list) st.tray(t.w, t.d, t.x, t.y, t.z, TRAY_RIM, 'logistics');
}

/** Where a building takes goods in from a tray: a slot under a steel hood. */
function intake(st: Builder, x: number, wallZ: number, w: number) {
  st.box('seam', w, 0.42, 0.1, x, T + 0.22, wallZ + 0.01, { c: 0 });
  st.box('hullDark', w + 0.2, 0.08, 0.4, x, T + 0.66, wallZ + 0.16, { c: 0.02, rotX: 0.25 });
  for (const sx of [-1, 1]) st.box('hullDark', 0.06, 0.5, 0.34, x + sx * (w / 2 + 0.07), T + 0.2, wallZ + 0.15, { c: 0.015 });
}

// ---------------------------------------------------------------------------
// Hub: a wide hangar. Four roller doors under a worn orange lintel, a control
// tower with a glazed cab and an antenna farm, and the stock yard on the roof.

function hub(): BuildingModel {
  const def = BUILDINGS.hub;
  const st = new Builder();
  const wb = new Builder(st);
  const rng = new Rand(11);
  pad(st, def.w, def.d);
  const cz = -1.2;
  const W = 13.2, H = 2.8, D = 6.2;
  const roof = T + H;
  const front = cz + D / 2;
  st.hull('hull', W, H, D, 0, T, cz, rng, { cell: 1.1, roof: 'hullSecondary' });
  // Frame: columns between the bays and along the back, a kick plate all round.
  st.on('front', 0, T, front, () => st.ribs('structure', W - 0.3, H + 0.06, 5, 0.26, 0.16));
  st.on('back', 0, T, cz - D / 2, () => st.ribs('structure', W - 0.3, H + 0.06, 7, 0.16, 0.12));
  for (const f of ['left', 'right'] as const) st.on(f, (f === 'left' ? -1 : 1) * (W / 2), T, cz, () => st.ribs('structure', D - 0.3, H + 0.06, 4, 0.16, 0.12));
  // Bays.
  for (const x of [-4.84, -1.61, 1.61, 4.84]) {
    st.on('front', x, T, front, () => {
      st.box('bay', 2.7, 2.0, 0.08, 0, 0, -0.02, { c: 0 });
      // Roller door, part raised.
      for (let k = 0; k < 4; k++) st.box('hullDark', 2.7, 0.12, 0.07, 0, 1.4 + k * 0.15, 0.02, { c: 0.02, tint: 0.9 + (k % 2) * 0.12 });
      st.box('structure', 2.9, 0.16, 0.3, 0, 2.0, 0.12, { c: 0.03 });
      lit(wb, 2.2, 0.06, 0, 1.9, 0.2);
      // Door posts with hazard feet.
      for (const sx of [-1, 1]) {
        st.box('hazard', 0.14, 0.3, 0.14, sx * 1.42, 0, 0.1, { c: 0.02 });
        st.box('structure', 0.14, 0.3, 0.14, sx * 1.42, 0.3, 0.1, { c: 0.02 });
        st.box('hazard', 0.14, 0.3, 0.14, sx * 1.42, 0.6, 0.1, { c: 0.02 });
      }
    });
  }
  st.box('logistics', W - 0.5, 0.2, 0.1, 0, T + 2.3, front + 0.04, { c: 0.02 });
  // Stock yard: one open bin per item, behind a rail.
  const bins: TraySpot[] = [];
  for (let k = 0; k < 6; k++) {
    bins.push({ x: -0.3 + (k % 3) * 2.5, y: roof + 0.03, z: cz - 1.35 + Math.floor(k / 3) * 2.7, w: 2.2, d: 2.4 });
  }
  for (const b of bins) {
    st.tray(b.w, b.d, b.x, b.y, b.z, 0.45, null);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) st.box('structure', 0.12, 0.6, 0.12, b.x + sx * b.w / 2, b.y, b.z + sz * b.d / 2, { c: 0.02 });
  }
  const ry = roof + 0.02;
  st.railing('hullDark', [[-1.7, ry, front - 0.15], [1.0, ry, front - 0.15], [3.6, ry, front - 0.15], [6.4, ry, front - 0.15], [6.4, ry, cz - 0.2], [6.4, ry, cz - D / 2 + 0.2]], 0.55);
  // Control tower.
  const bx = -4.4, bz = cz - 0.9;
  st.hull('hull', 3.4, 1.5, 3.0, bx, roof, bz, rng, { cell: 0.85 });
  const cab = roof + 1.5;
  st.box('hullDark', 3.0, 0.8, 2.6, bx, cab, bz, { c: 0.04 });
  st.on('front', bx, cab + 0.18, bz + 1.3, () => {
    for (const x of [-1.05, -0.35, 0.35, 1.05]) lit(wb, 0.6, 0.44, x, 0, 0.02);
  });
  st.on('right', bx + 1.5, cab + 0.18, bz, () => {
    for (const x of [-0.8, 0, 0.8]) lit(wb, 0.66, 0.44, x, 0, 0.02);
  });
  st.on('left', bx - 1.5, cab + 0.18, bz, () => {
    for (const x of [-0.8, 0, 0.8]) lit(wb, 0.66, 0.44, x, 0, 0.02);
  });
  const top = cab + 0.8;
  st.box('hull', 3.5, 0.12, 3.1, bx, top, bz, { c: 0.03 });
  st.box('hullSecondary', 0.8, 0.35, 0.6, bx + 0.9, top + 0.12, bz + 0.8, { c: 0.03 });
  st.on('front', bx + 0.9, top + 0.14, bz + 1.1, () => st.vent(0.6, 0.26, 0, 0, 3));
  st.geo('hull', new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), bx + 1.0, top + 0.12, bz - 0.9);
  for (const [dx, dz, h] of [[-1.4, 1.2, 1.6], [-1.5, -0.2, 1.1], [0.2, -1.3, 1.9]]) st.beam('structure', [bx + dx, top + 0.1, bz + dz], [bx + dx, top + 0.1 + h, bz + dz], 0.03, { round: true });
  st.on('right', bx + 1.72, roof, bz + 1.0, () => st.ladder('hullDark', 2.4));
  // Lattice mast for the dish.
  const mx = bx - 0.9, mz = bz - 0.7, mh = 2.0;
  const leg = (sx: number, sz: number, f: number): V3 => [mx + sx * (0.3 - 0.18 * f), top + 0.12 + mh * f, mz + sz * (0.3 - 0.18 * f)];
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i], [bx2, bz2] = corners[(i + 1) % 4];
    st.beam('structure', leg(ax, az, 0), leg(ax, az, 1), 0.05);
    for (const f of [0.33, 0.66]) st.beam('structure', leg(ax, az, f), leg(bx2, bz2, f), 0.03);
    st.beam('structure', leg(ax, az, 0), leg(bx2, bz2, 0.33), 0.025);
    st.beam('structure', leg(ax, az, 0.33), leg(bx2, bz2, 0.66), 0.025);
    st.beam('structure', leg(ax, az, 0.66), leg(bx2, bz2, 1), 0.025);
  }
  st.box('hullDark', 0.36, 0.08, 0.36, mx, top + 0.12 + mh, mz, { c: 0.02 });
  const dish = new THREE.Group();
  dish.position.set(mx, top + 0.2 + mh, mz);
  const arm = partMesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), roleMaterial('structure'));
  arm.position.set(0, 0.05, 0.25);
  dish.add(arm);
  const bowlGeo = new THREE.SphereGeometry(0.95, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.32);
  const bowl = partMesh(bowlGeo, new THREE.MeshStandardMaterial({ color: roleMaterial('hull').color, roughness: 0.8, side: THREE.DoubleSide }));
  bowl.rotation.x = -Math.PI / 2 - 0.5;
  bowl.position.set(0, 0.25, 1.15);
  dish.add(bowl);
  const feed = partMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), roleMaterial('structure'));
  feed.rotation.x = Math.PI / 2 - 0.5;
  feed.position.set(0, 0.4, 0.55);
  dish.add(feed);
  // Roof plant in front of the tower: tanks, a duct, cooling units.
  st.tank('hullSecondary', 0.42, 1.3, -5.7, roof, 0.9);
  st.tank('hullSecondary', 0.42, 1.3, -4.7, roof, 0.9);
  st.pipe('hullDark', [[-5.7, roof + 1.25, 0.9], [-5.7, roof + 1.5, 0.9], [-4.7, roof + 1.5, 0.9], [-4.7, roof + 1.25, 0.9]], 0.05, { metal: 0.6, flanges: false });
  st.pipe('hullDark', [[-4.3, roof + 0.4, 0.9], [-3.4, roof + 0.4, 0.9], [-3.4, roof + 0.4, bz + 1.5]], 0.06, { metal: 0.6 });
  for (const x of [-2.5, -1.9]) {
    st.box('hullSecondary', 0.5, 0.42, 0.9, x, roof, cz - 2.2, { c: 0.03 });
    st.cyl('structure', 0.17, 0.17, 0.04, x, roof + 0.42, cz - 2.2, { segs: 10, c: 0 });
  }
  st.box('hullSecondary', 0.34, 0.3, 4.6, -2.2, roof, cz + 0.4, { c: 0.03 });
  for (const z of [-1.2, 0, 1.2, 2.4]) st.box('hullDark', 0.4, 0.34, 0.06, -2.2, roof, cz + z, { c: 0.01 });
  const bulb = beacon(st, bx - 1.5, top + 0.12, bz + 1.3);
  return finish('hub', st, wb, bulb, { bins, parts: { dish } });
}

// ---------------------------------------------------------------------------
// Extractor: a lattice drilling derrick over the deposit, with an engine
// house and a mud tank. The drill string hammers up and down inside it.

function extractor(): BuildingModel {
  const st = new Builder();
  const wb = new Builder(st);
  const rng = new Rand(23);
  pad(st, 4, 4);
  const cz = -0.4;
  const H = 5.4;
  const half = (f: number) => 1.12 - 0.72 * f;
  const node = (sx: number, sz: number, f: number): V3 => [sx * half(f), T + H * f, cz + sz * half(f)];
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const levels = [0, 0.26, 0.5, 0.72, 0.9, 1];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
    st.beam('structure', node(ax, az, 0), node(ax, az, 1), 0.12);
    st.box('hullDark', 0.3, 0.06, 0.3, ax * half(0), T, cz + az * half(0), { c: 0.01 });
    for (let k = 0; k < levels.length - 1; k++) {
      const f0 = levels[k], f1 = levels[k + 1];
      st.beam('structure', node(ax, az, f1), node(bx, bz, f1), 0.07);
      st.beam('hullDark', node(ax, az, f0), node(bx, bz, f1), 0.045);
      st.beam('hullDark', node(bx, bz, f0), node(ax, az, f1), 0.045);
    }
  }
  // Crown block with sheaves.
  const top = T + H;
  st.box('hullSecondary', 1.0, 0.28, 1.0, 0, top, cz, { c: 0.04 });
  st.on('front', 0, top + 0.06, cz + 0.5, () => st.hazard(1.0, 0.14, 0.04, 0, 0, 0, 0.2));
  for (const x of [-0.2, 0.2]) st.cyl('hullDark', 0.26, 0.26, 0.07, x + 0.035, top + 0.5, cz, { rotZ: Math.PI / 2, segs: 14, c: 0.02, metal: 0.6 });
  st.box('structure', 0.7, 0.3, 0.12, 0, top + 0.28, cz, { c: 0.02 });
  // Wellhead.
  st.cyl('hullDark', 0.5, 0.56, 0.2, 0, T, cz, { segs: 14, metal: 0.5 });
  st.cyl('structure', 0.34, 0.38, 0.5, 0, T + 0.2, cz, { segs: 14 });
  st.cyl('hullDark', 0.44, 0.44, 0.08, 0, T + 0.7, cz, { segs: 14, metal: 0.5 });
  // Drill floor at the first level, with a rail.
  const f1 = levels[1];
  const hf = half(f1) + 0.12;
  const fy = T + H * f1;
  st.box('hullDark', hf * 2, 0.05, 0.4, 0, fy, cz - hf + 0.2, { c: 0.01 });
  st.box('hullDark', 0.4, 0.05, hf * 2, -hf + 0.2, fy, cz, { c: 0.01 });
  st.railing('hullDark', [[-hf, fy + 0.05, cz + hf], [-hf, fy + 0.05, cz - hf], [hf, fy + 0.05, cz - hf]], 0.5);
  st.on('left', -half(0) - 0.25, T, cz + 0.45, () => st.ladder('hullDark', H * f1));
  // Engine house.
  const ex = -1.2, ez = cz - 1.0;
  st.hull('hull', 1.5, 1.2, 1.1, ex, T, ez, rng, { cell: 0.7 });
  st.on('front', ex - 0.3, T + 0.25, ez + 0.55, () => st.vent(0.6, 0.6, 0, 0, 5));
  st.on('front', ex + 0.4, T + 0.7, ez + 0.55, () => lit(wb, 0.36, 0.2, 0, 0));
  st.pipe('structure', [[ex + 0.45, T + 1.2, ez - 0.2], [ex + 0.45, T + 2.1, ez - 0.2]], 0.07, { flanges: false });
  st.cyl('structure', 0.1, 0.1, 0.08, ex + 0.45, T + 2.1, ez - 0.2, { segs: 8 });
  st.box('logistics', 1.54, 0.12, 0.04, ex, T + 0.95, ez + 0.56, { c: 0.01 });
  st.on('top', 0, top + 0.28, cz + 0.5, () => {
    for (const x of [-0.4, 0.4]) lit(wb, 0.1, 0.1, x, 0.05, 0.02);
  });
  // Mud tank on saddles, piped to the wellhead.
  const tx = 1.25, tz = cz - 1.15;
  st.lathe('hullSecondary', [[0.2, 0], [0.4, 0.12], [0.4, 1.25], [0.2, 1.37]], tx + 0.68, T + 0.55, tz, { rotZ: Math.PI / 2, segs: 14 });
  for (const dx of [-0.4, 0.4]) st.box('structure', 0.1, 0.3, 0.7, tx + dx, T, tz, { c: 0.02 });
  for (const dx of [-0.3, 0.3]) st.cyl('structure', 0.42, 0.42, 0.05, tx + dx + 0.025, T + 0.55, tz, { rotZ: Math.PI / 2, segs: 14, c: 0.01 });
  st.pipe('hullDark', [[tx, T + 0.95, tz], [tx, T + 1.15, tz], [tx, T + 1.15, cz], [0.42, T + 0.45, cz]], 0.06, { metal: 0.6 });
  // Chute to the tray.
  st.box('hullDark', 0.7, 0.05, 1.0, 0.6, T + 0.42, cz + 0.95, { c: 0.01, rotX: 0.3 });
  for (const sx of [-1, 1]) st.box('hullDark', 0.05, 0.16, 1.0, 0.6 + sx * 0.35, T + 0.42, cz + 0.95, { c: 0.01, rotX: 0.3 });

  // The drill string: heavy, striped, hanging from a travelling block.
  const piston = kitPart((b) => {
    b.cyl('hullDark', 0.19, 0.19, 2.6, 0, 0, 0, { segs: 12, metal: 0.7 });
    b.cyl('structure', 0.3, 0.26, 0.3, 0, 0, 0, { segs: 12 });
    for (const [y, role] of [[0.55, 'hazard'], [0.69, 'structure'], [0.83, 'hazard']] as const) b.cyl(role, 0.25, 0.25, 0.14, 0, y, 0, { segs: 12, c: 0.015 });
    b.box('hullSecondary', 0.56, 0.5, 0.44, 0, 2.6, 0, { c: 0.05 });
    b.box('hazard', 0.6, 0.1, 0.48, 0, 2.8, 0, { c: 0.01 });
    b.beam('structure', [-0.1, 3.1, 0], [-0.1, 6.3, 0], 0.025, { round: true });
    b.beam('structure', [0.1, 3.1, 0], [0.1, 6.3, 0], 0.025, { round: true });
  });
  piston.position.set(0, T + 1.75, cz);
  piston.userData.baseY = piston.position.y;
  const outTrays: TraySpot[] = [{ x: 0.75, y: T, z: 1.4, w: 1.6, d: 1.05 }];
  trays(st, outTrays);
  const bulb = beacon(st, 0, top + 0.76, cz);
  return finish('extractor', st, wb, bulb, {
    outTrays,
    parts: { piston },
    smokeAt: new THREE.Vector3(ex + 0.45, T + 2.25, ez - 0.2),
    smokeKind: 'exhaust',
  });
}

// ---------------------------------------------------------------------------
// Smelter: a small blast furnace. A ribbed vessel ringed by glowing tuyeres
// and a bustle pipe, a skip incline up to its throat, a downcomer across to a
// gas cleaner with the stack on top, and a runner of molten metal at its foot.

function smelter(): BuildingModel {
  const st = new Builder();
  const wb = new Builder(st);
  const gb = new Builder();
  const rng = new Rand(37);
  pad(st, 5, 5);
  const fx = 0.55, fz = -0.4;
  // Vessel.
  st.lathe('furnace', [[1.2, 0, 1], [1.36, 0.22], [1.36, 1.3, 1], [1.3, 1.38], [1.14, 2.5, 1], [1.14, 2.58], [1.14, 3.1, 1], [0.74, 3.7, 1], [0.5, 3.92]], fx, T, fz, { segs: 20 });
  for (const [y, r] of [[0.22, 1.39], [1.3, 1.39], [2.5, 1.18], [3.1, 1.18]]) st.cyl('hullDark', r, r, 0.1, fx, T + y - 0.05, fz, { segs: 20, c: 0.02, metal: 0.4 });
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.31;
    st.box('structure', 0.07, 1.02, 0.07, fx + Math.sin(a) * 1.38, T + 0.28, fz + Math.cos(a) * 1.38, { c: 0.01, rotY: a });
  }
  // Tuyeres: glowing ports under a bustle pipe.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const sx = Math.sin(a), cz2 = Math.cos(a);
    st.box('structure', 0.26, 0.26, 0.1, fx + sx * 1.37, T + 0.6, fz + cz2 * 1.37, { c: 0.02, rotY: a });
    gb.box('furnaceGlow', 0.14, 0.14, 0.04, fx + sx * 1.43, T + 0.66, fz + cz2 * 1.43, { c: 0, rotY: a });
    st.beam('hullDark', [fx + sx * 1.42, T + 0.86, fz + cz2 * 1.42], [fx + sx * 1.56, T + 1.5, fz + cz2 * 1.56], 0.07, { round: true, metal: 0.5 });
  }
  st.geo('hullDark', new THREE.TorusGeometry(1.58, 0.1, 8, 28), fx, T + 1.55, fz, { rotX: Math.PI / 2, metal: 0.5 });
  // Throat platform and rail.
  st.cyl('hullDark', 1.5, 1.5, 0.05, fx, T + 3.1, fz, { segs: 16, c: 0 });
  st.geo('hullDark', new THREE.TorusGeometry(1.48, 0.022, 5, 24), fx, T + 3.6, fz, { rotX: Math.PI / 2 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    st.beam('hullDark', [fx + Math.sin(a) * 1.48, T + 3.15, fz + Math.cos(a) * 1.48], [fx + Math.sin(a) * 1.48, T + 3.6, fz + Math.cos(a) * 1.48], 0.03);
  }
  // Gas cleaner on legs, with the stack rising out of it.
  const gx = -1.5, gz = -1.55;
  st.lathe('hullSecondary', [[0.14, 1.1], [0.58, 2.0, 1], [0.58, 2.08], [0.58, 3.0, 1], [0.3, 3.4]], gx, T, gz, { segs: 14 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    st.beam('structure', [gx + Math.sin(a) * 0.62, T, gz + Math.cos(a) * 0.62], [gx + Math.sin(a) * 0.5, T + 2.2, gz + Math.cos(a) * 0.5], 0.08);
  }
  st.cyl('hullDark', 0.22, 0.28, 3.9, gx, T + 3.35, gz, { segs: 14, c: 0.02 });
  for (const y of [4.3, 5.4, 6.5]) st.cyl('structure', 0.3, 0.3, 0.07, gx, T + y, gz, { segs: 14, c: 0.01 });
  st.cyl('structure', 0.25, 0.25, 0.5, gx, T + 6.75, gz, { segs: 14, c: 0.02 });
  st.on('front', gx, T + 3.4, gz + 0.26, () => st.ladder('hullDark', 3.2));
  // Downcomer from the throat to the cleaner.
  st.pipe('hullSecondary', [[fx, T + 3.85, fz], [fx, T + 4.75, fz], [gx + 0.15, T + 3.2, gz + 0.3]], 0.17, { tint: 0.9 });
  // Skip incline from the charging hopper to the throat.
  const foot = new THREE.Vector3(-1.35, T + 0.75, 1.05);
  const head = new THREE.Vector3(fx - 0.5, T + 3.95, fz + 0.25);
  const along = head.clone().sub(foot);
  const side = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.24);
  const P = (t: number, s: number, dy = 0): V3 => [foot.x + along.x * t + side.x * s, foot.y + along.y * t + dy, foot.z + along.z * t + side.z * s];
  for (const s of [-1, 1]) {
    st.beam('structure', P(0, s), P(1, s), 0.08);
    st.beam('structure', P(0, s, -0.3), P(1, s, -0.3), 0.05);
    for (let k = 0; k <= 6; k++) st.beam('hullDark', P(k / 6, s), P(Math.min(1, (k + 0.5) / 6), s, -0.3), 0.035);
  }
  for (let k = 0; k <= 8; k++) st.beam('hullDark', P(k / 8, -1), P(k / 8, 1), 0.035);
  for (const t of [0.35, 0.72]) for (const s of [-1, 1]) st.beam('structure', P(t, s, -0.3), [P(t, s)[0], T, P(t, s)[2]], 0.07);
  // The skip car, part way up.
  const car = P(0.42, 0, 0.06);
  st.box('hullSecondary', 0.42, 0.3, 0.5, car[0], car[1], car[2], { c: 0.03, rotY: Math.atan2(along.x, along.z), rotX: -0.6 });
  // Charging hopper over the in-tray.
  st.lathe('hullSecondary', [[0.2, 0], [0.62, 0.55, 1], [0.62, 0.66]], -1.35, T + 0.35, 1.0, { segs: 4, rotY: Math.PI / 4 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) st.beam('structure', [-1.35 + sx * 0.42, T, 1.0 + sz * 0.42], [-1.35 + sx * 0.42, T + 0.95, 1.0 + sz * 0.42], 0.06);
  // Tap hole and runner to the out-tray.
  const dir = new THREE.Vector3(1.3 - fx, 0, 1.3 - fz).normalize();
  const ang = Math.atan2(dir.x, dir.z);
  const tap: V3 = [fx + dir.x * 1.34, T + 0.26, fz + dir.z * 1.34];
  st.box('structure', 0.5, 0.5, 0.16, tap[0], T + 0.02, tap[2], { c: 0.03, rotY: ang });
  gb.box('furnaceGlow', 0.28, 0.26, 0.05, tap[0] + dir.x * 0.07, T + 0.12, tap[2] + dir.z * 0.07, { c: 0, rotY: ang });
  const r0: V3 = [tap[0] + dir.x * 0.1, T + 0.02, tap[2] + dir.z * 0.1];
  const r1: V3 = [1.3, T + 0.02, 1.2];
  st.beam('structure', r0, r1, 0.3);
  gb.beam('furnaceGlow', [r0[0], T + 0.08, r0[2]], [r1[0], T + 0.08, r1[2]], 0.13);
  st.box('hullDark', 0.7, 0.08, 0.5, tap[0] + dir.x * 0.25, T + 0.62, tap[2] + dir.z * 0.25, { c: 0.02, rotY: ang, rotX: 0.2 });
  // Control cabin and a tank, tucked behind.
  const cx = 1.8, cz = -1.85;
  st.hull('hull', 1.3, 1.5, 1.2, cx, T, cz, rng, { cell: 0.65 });
  st.on('front', cx, T + 0.85, cz + 0.6, () => lit(wb, 0.9, 0.3, 0, 0));
  st.on('right', cx + 0.65, T + 0.2, cz, () => st.vent(0.5, 0.5, 0, 0, 4));
  st.box('logistics', 1.34, 0.12, 0.04, cx, T + 1.2, cz + 0.61, { c: 0.01 });
  st.on('left', cx - 0.65, T + 0.85, cz, () => lit(wb, 0.8, 0.3, 0, 0));
  wb.cyl('structure', 0.07, 0.07, 0.1, gx, T + 7.25, gz, { segs: 8, c: 0 });
  st.tank('hullSecondary', 0.3, 1.5, 2.1, T, 0.2);
  st.pipe('hullDark', [[2.1, T + 1.45, 0.2], [2.1, T + 1.7, 0.2], [fx + 1.5, T + 1.55, fz + 0.5]], 0.05, { metal: 0.6 });
  const glow = glowMaterial('structure', 'furnaceGlow', 0);
  const mouth = partMesh(gb.geometry(), glow);
  mouth.castShadow = false;
  const inTrays: TraySpot[] = [{ x: -1.3, y: T, z: 1.75, w: 1.6, d: 1.05 }];
  const outTrays: TraySpot[] = [{ x: 1.3, y: T, z: 1.75, w: 1.6, d: 1.05 }];
  trays(st, inTrays);
  trays(st, outTrays);
  const bulb = beacon(st, cx + 0.3, T + 1.5, cz - 0.2);
  return finish('smelter', st, wb, bulb, {
    inTrays,
    outTrays,
    parts: { mouth },
    glow,
    smokeAt: new THREE.Vector3(gx, T + 7.4, gz),
  });
}

// ---------------------------------------------------------------------------
// Fabricator: a framed hall with roof plant, feeding a four-column hydraulic
// press. The ram, striped yellow and black, stamps under a narrow crown.

function fabricator(): BuildingModel {
  const st = new Builder();
  const wb = new Builder(st);
  const rng = new Rand(51);
  pad(st, 8, 5);
  const cz = -0.8;
  const hx = -1.55, HW = 4.6, HH = 2.3, HD = 3.1;
  const front = cz + HD / 2;
  const roof = T + HH;
  st.hull('hull', HW, HH, HD, hx, T, cz, rng, { cell: 0.95, roof: 'hullSecondary' });
  st.on('front', hx, T, front, () => st.ribs('structure', HW - 0.2, HH + 0.08, 5, 0.14, 0.14));
  st.on('back', hx, T, cz - HD / 2, () => st.ribs('structure', HW - 0.2, HH + 0.08, 5, 0.14, 0.14));
  st.on('left', hx - HW / 2, T, cz, () => {
    st.ribs('structure', HD - 0.2, HH + 0.08, 3, 0.14, 0.14);
    st.ladder('hullDark', HH + 0.3, 0.8);
  });
  st.box('structure', HW + 0.1, 0.12, 0.1, hx, roof - 0.06, front + 0.05, { c: 0.02 });
  st.box('logistics', HW - 0.4, 0.14, 0.04, hx, T + 1.45, front + 0.02, { c: 0.01 });
  for (const x of [-2.9, -1.15]) intake(st, x, front, 1.2);
  st.on('front', hx + 1.75, T + 1.7, front, () => st.vent(0.7, 0.4, 0, 0, 3));
  st.on('front', hx, T + 1.75, front, () => {
    for (const x of [-1.9, -1.0, -0.1]) lit(wb, 0.5, 0.2, x, 0, 0.05);
  });
  st.on('front', 3.5, T + 0.55, cz - 0.9, () => {
    for (const x of [-0.2, 0, 0.2]) lit(wb, 0.08, 0.08, x, 0, 0.02);
  });
  // Roof: a glazed monitor along the ridge, two extract fans, a cooler, a duct.
  st.box('hullDark', 3.4, 0.34, 0.9, hx - 0.3, roof, cz + 0.1, { c: 0.03 });
  st.box('hull', 3.6, 0.07, 1.1, hx - 0.3, roof + 0.34, cz + 0.1, { c: 0.02 });
  for (const f of ['front', 'back'] as const) {
    st.on(f, hx - 0.3, roof + 0.08, cz + 0.1 + (f === 'front' ? 0.45 : -0.45), () => {
      for (let k = 0; k < 5; k++) lit(wb, 0.56, 0.18, -1.36 + k * 0.68, 0, 0.02);
    });
  }
  for (const x of [hx - 1.4, hx + 0.6]) {
    st.cyl('hullDark', 0.4, 0.44, 0.34, x, roof, cz - 1.0, { segs: 14, c: 0.03 });
    st.cyl('seam', 0.33, 0.33, 0.03, x, roof + 0.33, cz - 1.0, { segs: 14, c: 0 });
    st.box('structure', 0.72, 0.03, 0.05, x, roof + 0.35, cz - 1.0, { c: 0 });
    st.box('structure', 0.05, 0.03, 0.72, x, roof + 0.35, cz - 1.0, { c: 0 });
  }
  st.box('hullSecondary', 0.9, 0.46, 0.6, hx + 1.7, roof, cz + 1.0, { c: 0.03 });
  st.on('front', hx + 1.7, roof + 0.08, cz + 1.3, () => st.vent(0.7, 0.3, 0, 0, 3));
  st.box('hullSecondary', 0.34, 0.3, 1.5, hx + 1.9, roof, cz - 0.5, { c: 0.03 });
  for (const z of [-1.1, -0.5, 0.1]) st.box('hullDark', 0.4, 0.34, 0.05, hx + 1.9, roof, cz + z, { c: 0.01 });
  st.railing('hullDark', [[hx - HW / 2 + 0.1, roof, front - 0.1], [hx - 0.8, roof, front - 0.1], [hx + 0.9, roof, front - 0.1]], 0.5);
  // Transfer housing between hall and press.
  st.box('hullDark', 0.9, 1.0, 1.3, 1.0, T, cz, { c: 0.04 });
  st.on('top', 1.0, T + 1.0, cz + 0.3, () => st.vent(0.6, 0.5, 0, 0, 4));
  // Press: bolster, four polished columns, a narrow crown with two cylinders.
  const px = 2.5;
  st.box('hullDark', 2.3, 0.85, 2.3, px, T, cz, { c: 0.05 });
  st.on('front', px, T + 0.66, cz + 1.15, () => st.hazard(2.3, 0.16, 0.04, 0, 0, 0, 0.23));
  st.box('structure', 1.6, 0.1, 1.5, px, T + 0.85, cz, { c: 0.02, metal: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    st.cyl('chrome', 0.11, 0.11, 2.75, px + sx * 0.95, T + 0.85, cz + sz * 0.42, { segs: 12, c: 0, metal: 1 });
    st.cyl('hullDark', 0.17, 0.17, 0.14, px + sx * 0.95, T + 0.85, cz + sz * 0.42, { segs: 10, c: 0.02 });
  }
  const crown = T + 3.5;
  st.box('hullSecondary', 2.4, 0.7, 1.25, px, crown, cz, { c: 0.06 });
  st.on('front', px, crown + 0.05, cz + 0.625, () => st.hazard(2.3, 0.14, 0.03, 0, 0, 0, 0.23));
  for (const sx of [-1, 1]) {
    st.cyl('hullDark', 0.27, 0.27, 0.75, px + sx * 0.5, crown + 0.7, cz, { segs: 12, c: 0.03, metal: 0.5 });
    st.cyl('structure', 0.3, 0.3, 0.08, px + sx * 0.5, crown + 1.1, cz, { segs: 12, c: 0.01 });
  }
  // Hydraulic power unit, hosed to the cylinders.
  const ux = 3.5, uz = cz - 1.3;
  st.hull('hullSecondary', 0.9, 1.0, 0.8, ux, T, uz, rng, { cell: 0.5 });
  st.tank('hull', 0.2, 0.7, ux - 0.15, T + 1.0, uz);
  st.pipe('structure', [[ux + 0.2, T + 1.0, uz], [ux + 0.2, crown + 1.3, uz], [px + 0.5, crown + 1.3, cz - 0.2], [px + 0.5, crown + 1.18, cz - 0.1]], 0.045, { flanges: false });
  st.pipe('structure', [[ux + 0.05, T + 1.0, uz + 0.2], [ux + 0.05, crown + 1.5, uz + 0.2], [px - 0.5, crown + 1.5, cz - 0.2], [px - 0.5, crown + 1.18, cz - 0.1]], 0.045, { flanges: false });
  // Roller table to the out-tray.
  for (const sx of [-1, 1]) {
    st.box('structure', 0.06, 0.1, 0.95, px + sx * 0.62, T + 0.42, cz + 1.6, { c: 0.01 });
    st.box('structure', 0.06, 0.42, 0.06, px + sx * 0.62, T, cz + 1.95, { c: 0.01 });
  }
  for (let k = 0; k < 5; k++) st.cyl('chrome', 0.055, 0.055, 1.2, px + 0.6, T + 0.5, cz + 1.22 + k * 0.19, { rotZ: Math.PI / 2, segs: 8, c: 0, metal: 0.9 });

  const ram = kitPart((b) => {
    b.box('structure', 1.75, 0.12, 1.5, 0, 0, 0, { c: 0.02, metal: 0.5 });
    b.box('hullSecondary', 1.7, 0.5, 1.56, 0, 0.12, 0, { c: 0.05 });
    b.on('front', 0, 0.3, 0.78, () => b.hazard(1.7, 0.18, 0.03, 0, 0, 0, 0.17));
    b.on('back', 0, 0.3, -0.78, () => b.hazard(1.7, 0.18, 0.03, 0, 0, 0, 0.17));
    for (const sx of [-1, 1]) b.cyl('chrome', 0.1, 0.1, 2.0, sx * 0.5, 0.62, 0, { segs: 10, c: 0, metal: 1 });
  });
  ram.position.set(px, T + 1.9, cz);
  ram.userData.baseY = ram.position.y;
  const inTrays: TraySpot[] = [
    { x: -2.9, y: T, z: 1.75, w: 1.5, d: 1.05 },
    { x: -1.15, y: T, z: 1.75, w: 1.5, d: 1.05 },
  ];
  const outTrays: TraySpot[] = [{ x: px, y: T, z: 1.85, w: 1.6, d: 0.95 }];
  trays(st, inTrays);
  trays(st, outTrays);
  const bulb = beacon(st, px, crown + 0.7, cz + 0.4);
  return finish('fabricator', st, wb, bulb, { inTrays, outTrays, parts: { ram } });
}

function generic(type: BuildingTypeId): BuildingModel {
  const def = BUILDINGS[type];
  const st = new Builder();
  pad(st, def.w, def.d);
  st.hull('hull', def.w * 0.8, 2, def.d * 0.7, 0, T, -def.d * 0.1, new Rand(5));
  const bulb = beacon(st, 0, T + 2, -def.d * 0.2);
  return finish(type, st, new Builder(), bulb, {});
}

export function buildModel(type: BuildingTypeId): BuildingModel {
  switch (type) {
    case 'hub':
      return hub();
    case 'extractor':
      return extractor();
    case 'smelter':
      return smelter();
    case 'fabricator':
      return fabricator();
    default:
      return generic(type);
  }
}
