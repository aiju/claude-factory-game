// Building meshes, composed from the model kit. Local frame: +Z is the front
// (the dock side), Y up, origin at ground level.
//
// Designed for the view from above: every roof carries the building's moving
// part and enough form to read as a machine. White hull on a pale concrete
// pad; graphite for mechanisms; orange only on tray lips and the dock edge.

import * as THREE from 'three';
import { BUILDINGS, type BuildingTypeId } from '../data/buildings';
import { Builder, boxGeo, glowMaterial, kitMaterial, partMesh, roleMaterial } from './kit';

/** Height of the concrete pad above the ground at the building's origin. */
export const PAD_TOP = 0.2;

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
  /** Where smoke leaves the stack, local. */
  smokeAt: THREE.Vector3 | null;
}

function pad(st: Builder, w: number, d: number) {
  st.box('pad', w, 1.6 + PAD_TOP, d, 0, -1.6, 0, { bevel: 0.08 });
}

/** A slightly darker inset panel, so a roof is never one blank plane. */
function roofPanel(st: Builder, w: number, d: number, x: number, y: number, z: number) {
  st.box('hullSecondary', w, 0.07, d, x, y - 0.01, z, { bevel: 0.02 });
}

type Face = 'front' | 'left' | 'right' | 'back';
/** Windows: thin panels on a wall. `face` is the outward direction. */
function windowPanels(wb: Builder, list: { x: number; y: number; z: number; w: number; h: number; face: Face }[]) {
  for (const p of list) {
    const rotY = p.face === 'front' ? 0 : p.face === 'back' ? Math.PI : p.face === 'left' ? -Math.PI / 2 : Math.PI / 2;
    wb.box('structure', p.w, p.h, 0.06, p.x, p.y, p.z, { bevel: 0.015, rotY });
  }
}

function lampPost(st: Builder, x: number, y: number, z: number): THREE.Mesh {
  st.cyl('structure', 0.05, 0.05, 0.45, x, y, z, { segs: 8 });
  st.cyl('structure', 0.16, 0.18, 0.08, x, y + 0.45, z, { segs: 12 });
  const bulb = partMesh(new THREE.SphereGeometry(0.16, 14, 10), glowMaterial('hullSecondary', 'hazard', 0));
  bulb.position.set(x, y + 0.61, z);
  bulb.castShadow = false;
  return bulb;
}

/** Where a building takes goods in from a tray: a low slot under a small hood. */
function intake(st: Builder, x: number, y: number, wallZ: number, w: number) {
  st.box('structure', w, 0.4, 0.1, x, y + 0.24, wallZ + 0.01, { bevel: 0.03 });
  st.box('hullSecondary', w + 0.2, 0.12, 0.36, x, y + 0.66, wallZ + 0.1, { bevel: 0.04 });
}

const TRAY_RIM = 0.2;

function pulseRim(t: TraySpot): THREE.Mesh {
  const b = new Builder();
  const r = 0.09;
  const h = 0.05;
  const y = t.y + TRAY_RIM + 0.01;
  b.box('hazard', t.w + 0.06, h, r, t.x, y, t.z - t.d / 2 + r / 2, { bevel: 0 });
  b.box('hazard', t.w + 0.06, h, r, t.x, y, t.z + t.d / 2 - r / 2, { bevel: 0 });
  b.box('hazard', r, h, t.d, t.x - t.w / 2 + r / 2, y, t.z, { bevel: 0 });
  b.box('hazard', r, h, t.d, t.x + t.w / 2 - r / 2, y, t.z, { bevel: 0 });
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
  };
}

function trays(st: Builder, list: TraySpot[]) {
  for (const t of list) st.tray(t.w, t.d, t.x, t.y, t.z, TRAY_RIM, 'logistics');
}

function cylPart(role: Parameters<typeof roleMaterial>[0], rTop: number, rBot: number, h: number, y: number, segs = 16): THREE.Mesh {
  const m = partMesh(new THREE.CylinderGeometry(rTop, rBot, h, segs), roleMaterial(role));
  m.position.y = y + h / 2;
  return m;
}

// ---------------------------------------------------------------------------
// Hub: low and wide. Four hauler bays along the front under an orange dock
// band, a control block with a mast and dish, and the stock yard on the roof.

function hub(): BuildingModel {
  const def = BUILDINGS.hub;
  const st = new Builder();
  const wb = new Builder();
  const T = PAD_TOP;
  pad(st, def.w, def.d);
  const cz = -1.2;
  const H = 2.6;
  const roof = T + H;
  const front = cz + 3.1;
  st.box('hull', 13.2, H, 6.2, 0, T, cz, { bevel: 0.24 });
  roofPanel(st, 12.4, 5.4, 0, roof, cz);
  // Bays: shaded interiors, a canopy over each, a strip light under it.
  for (const x of [-4.65, -1.55, 1.55, 4.65]) {
    st.box('bay', 2.5, 1.8, 0.1, x, T, front, { bevel: 0.02 });
    st.box('hull', 2.74, 0.16, 0.46, x, T + 1.8, front + 0.12, { bevel: 0.05 });
    wb.box('structure', 2.1, 0.07, 0.07, x, T + 1.68, front + 0.09, { bevel: 0.02 });
    st.box('hullSecondary', 2.5, 0.05, 0.5, x, T, front + 0.28, { bevel: 0.02 });
  }
  st.box('logistics', 12.5, 0.14, 0.1, 0, T + 2.14, front + 0.02, { bevel: 0.03 });
  // Control block.
  const bx = -4.2;
  const bz = cz - 0.9;
  st.box('hull', 4.0, 1.5, 3.4, bx, roof, bz, { bevel: 0.2 });
  const croof = roof + 1.5;
  roofPanel(st, 3.2, 2.6, bx, croof, bz);
  st.box('hullSecondary', 0.9, 0.3, 0.7, bx + 0.9, croof, bz + 0.6, { bevel: 0.07 });
  windowPanels(wb, [
    { x: bx - 1.15, y: roof + 0.6, z: bz + 1.71, w: 0.9, h: 0.5, face: 'front' },
    { x: bx, y: roof + 0.6, z: bz + 1.71, w: 0.9, h: 0.5, face: 'front' },
    { x: bx + 1.15, y: roof + 0.6, z: bz + 1.71, w: 0.9, h: 0.5, face: 'front' },
    { x: bx + 2.01, y: roof + 0.6, z: bz + 0.7, w: 0.9, h: 0.5, face: 'right' },
    { x: bx + 2.01, y: roof + 0.6, z: bz - 0.5, w: 0.9, h: 0.5, face: 'right' },
  ]);
  // Stock yard: one open bin per item.
  const bins: TraySpot[] = [];
  for (let k = 0; k < 6; k++) {
    bins.push({ x: -0.3 + (k % 3) * 2.5, y: roof + 0.04, z: cz - 1.35 + Math.floor(k / 3) * 2.7, w: 2.2, d: 2.4 });
  }
  for (const b of bins) st.tray(b.w, b.d, b.x, b.y, b.z, 0.42, null);
  // Mast and dish.
  const mx = bx - 1.2;
  const mz = bz - 1.0;
  st.cyl('structure', 0.1, 0.14, 2.2, mx, croof, mz, { segs: 10 });
  const dish = new THREE.Group();
  dish.position.set(mx, croof + 2.2, mz);
  const arm = partMesh(boxGeo(0.12, 0.12, 0.7, 0.02), roleMaterial('structure'));
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
  const bulb = lampPost(st, 6.1, roof, cz - 2.6);
  return finish('hub', st, wb, bulb, { bins, parts: { dish } });
}

// ---------------------------------------------------------------------------
// Extractor: a squat tower over the deposit. The hammer drives down through
// the base; its rod and cap rise and fall above the roof.

function extractor(): BuildingModel {
  const st = new Builder();
  const wb = new Builder();
  const T = PAD_TOP;
  pad(st, 4, 4);
  const cz = -0.5;
  st.box('hull', 3.2, 0.9, 2.6, 0, T, cz, { bevel: 0.2 });
  st.cyl('structure', 0.56, 0.6, 0.16, 0, T + 0.9, cz, { segs: 20 });
  for (const x of [-1.12, 1.12]) {
    for (const z of [cz - 0.86, cz + 0.86]) st.box('hull', 0.34, 2.75, 0.34, x, T + 0.8, z, { bevel: 0.08 });
    st.box('structure', 0.12, 0.12, 1.5, x, T + 2.2, cz, { bevel: 0.03 });
  }
  for (const z of [cz - 0.86, cz + 0.86]) st.box('structure', 2.0, 0.12, 0.12, 0, T + 2.2, z, { bevel: 0.03 });
  // Head.
  st.box('hull', 2.9, 1.0, 2.4, 0, T + 3.45, cz, { bevel: 0.24 });
  const roof = T + 4.45;
  roofPanel(st, 2.2, 1.7, 0, roof, cz);
  st.cyl('structure', 0.36, 0.4, 0.2, 0, roof, cz, { segs: 16 });
  st.box('hullSecondary', 0.75, 0.4, 0.6, -0.8, roof, cz - 0.45, { bevel: 0.08 });
  windowPanels(wb, [
    { x: -0.5, y: T + 3.82, z: cz + 1.21, w: 0.6, h: 0.34, face: 'front' },
    { x: 0.25, y: T + 3.82, z: cz + 1.21, w: 0.6, h: 0.34, face: 'front' },
  ]);
  // Spout over the tray.
  st.box('hullSecondary', 1.1, 0.5, 0.4, 0.75, T + 0.28, cz + 1.4, { bevel: 0.08 });
  st.box('structure', 0.8, 0.26, 0.1, 0.75, T + 0.34, cz + 1.57, { bevel: 0.02 });

  const piston = new THREE.Group();
  piston.add(cylPart('structure', 0.34, 0.34, 2.3, 0));
  piston.add(cylPart('hullSecondary', 0.43, 0.43, 0.24, 0.1));
  piston.add(cylPart('hullSecondary', 0.13, 0.13, 2.3, 2.3, 10));
  piston.add(cylPart('structure', 0.27, 0.27, 0.16, 4.6));
  piston.position.set(0, T + 1.35, cz);
  piston.userData.baseY = piston.position.y;
  const outTrays: TraySpot[] = [{ x: 0.75, y: T, z: 1.4, w: 1.6, d: 1.05 }];
  trays(st, outTrays);
  const bulb = lampPost(st, 1.05, roof, cz - 0.8);
  return finish('extractor', st, wb, bulb, { outTrays, parts: { piston } });
}

// ---------------------------------------------------------------------------
// Smelter: a furnace body with a glowing crown on the roof and a tall stack.
// The crown and the mouth light up together while it works.

function smelter(): BuildingModel {
  const st = new Builder();
  const wb = new Builder();
  const gb = new Builder();
  const T = PAD_TOP;
  pad(st, 5, 5);
  const cz = -0.8;
  const H = 2.2;
  const roof = T + H;
  const front = cz + 1.5;
  st.box('hull', 4.4, H, 3.0, 0, T, cz, { bevel: 0.22 });
  roofPanel(st, 3.7, 2.3, 0, roof, cz);
  // Furnace crown with a grate.
  const fx = 0.75;
  const fz = cz + 0.15;
  st.cyl('hull', 1.0, 1.08, 0.55, fx, roof, fz, { segs: 28 });
  st.cyl('structure', 0.86, 0.86, 0.1, fx, roof + 0.55, fz, { segs: 28 });
  gb.cyl('furnaceGlow', 0.72, 0.72, 0.04, fx, roof + 0.63, fz, { segs: 24 });
  for (const [dx, len] of [[-0.36, 1.5], [0, 1.68], [0.36, 1.5]]) st.box('structure', 0.1, 0.08, len, fx + dx, roof + 0.65, fz, { bevel: 0.02 });
  // Stack: pale shaft, dark top.
  const sx = -1.35;
  const sz = cz - 0.75;
  st.cyl('hullSecondary', 0.58, 0.64, 0.45, sx, roof, sz, { segs: 20 });
  st.cyl('hull', 0.36, 0.44, 3.4, sx, roof + 0.45, sz, { segs: 20 });
  st.cyl('structure', 0.41, 0.41, 0.5, sx, roof + 3.5, sz, { segs: 20 });
  st.geo('structure', new THREE.CylinderGeometry(0.13, 0.13, 0.9, 10), -0.5, roof + 0.28, cz - 0.39, { rotZ: Math.PI / 2, rotY: 2.736 });
  // Roof vent.
  st.box('hullSecondary', 0.9, 0.28, 0.7, -1.25, roof, cz + 0.8, { bevel: 0.06 });
  for (const dz of [-0.2, 0, 0.2]) st.box('structure', 0.7, 0.03, 0.08, -1.25, roof + 0.28, cz + 0.8 + dz, { bevel: 0 });
  // Front: intake over the in-tray, mouth over the out-tray.
  intake(st, -1.3, T, front, 1.3);
  st.box('structure', 1.5, 1.05, 0.16, 1.3, T + 0.25, front + 0.02, { bevel: 0.04 });
  gb.box('furnaceGlow', 1.1, 0.62, 0.06, 1.3, T + 0.45, front + 0.1, { bevel: 0.02 });
  st.box('hullSecondary', 1.7, 0.14, 0.45, 1.3, T + 1.32, front + 0.14, { bevel: 0.04 });
  windowPanels(wb, [
    { x: -1.65, y: T + 1.3, z: front + 0.01, w: 0.55, h: 0.34, face: 'front' },
    { x: -0.95, y: T + 1.3, z: front + 0.01, w: 0.55, h: 0.34, face: 'front' },
  ]);
  const glow = glowMaterial('structure', 'furnaceGlow', 0);
  const mouth = partMesh(gb.geometry(), glow);
  mouth.castShadow = false;
  const inTrays: TraySpot[] = [{ x: -1.3, y: T, z: 1.75, w: 1.6, d: 1.05 }];
  const outTrays: TraySpot[] = [{ x: 1.3, y: T, z: 1.75, w: 1.6, d: 1.05 }];
  trays(st, inTrays);
  trays(st, outTrays);
  const bulb = lampPost(st, 1.85, roof, cz - 1.15);
  return finish('smelter', st, wb, bulb, {
    inTrays,
    outTrays,
    parts: { mouth },
    glow,
    smokeAt: new THREE.Vector3(sx, roof + 4.1, sz),
  });
}

// ---------------------------------------------------------------------------
// Fabricator: a sawtooth-roofed shed whose skylights are its windows, and an
// open press at one end. The ram is visible either side of a narrow crosshead.

function fabricator(): BuildingModel {
  const st = new Builder();
  const wb = new Builder();
  const T = PAD_TOP;
  pad(st, 8, 5);
  const cz = -0.8;
  const front = cz + 1.55;
  // Shed.
  const sx = -1.55;
  const sw = 4.5;
  const sh = 1.7;
  st.box('hull', sw, sh, 3.1, sx, T, cz, { bevel: 0.2 });
  const tooth = 1.5;
  const slope = Math.atan2(0.72, tooth - 0.14);
  for (let k = 0; k < 3; k++) {
    const x0 = sx - sw / 2 + k * tooth;
    const y0 = T + sh - 0.04;
    st.profile('hull', [[0, 0], [tooth, 0], [0.14, 0.72], [0, 0.72]], 2.8, 'z', x0, y0, cz, { bevel: 0.08, corner: 0.05 });
    // Skylight: three panes in a dark frame, lying on the slope.
    st.box('structure', 0.74, 0.04, 2.36, x0 + 0.84, y0 + 0.36, cz, { bevel: 0.01, rotZ: -slope });
    for (const dz of [-0.76, 0, 0.76]) wb.box('structure', 0.6, 0.05, 0.66, x0 + 0.845, y0 + 0.37, cz + dz, { bevel: 0.015, rotZ: -slope });
  }
  for (const x of [-2.9, -1.15]) intake(st, x, T, front, 1.2);
  // Link between shed and press.
  st.box('hullSecondary', 1.0, 1.2, 2.0, 0.95, T, cz, { bevel: 0.12 });
  // Press.
  const px = 2.45;
  st.box('hullSecondary', 2.5, 0.95, 2.5, px, T, cz, { bevel: 0.14 });
  st.box('structure', 1.5, 0.12, 1.3, px, T + 0.95, cz, { bevel: 0.03 });
  for (const dx of [-1.05, 1.05]) st.box('hull', 0.5, 3.0, 1.5, px + dx, T + 0.9, cz, { bevel: 0.14 });
  st.box('structure', 2.9, 0.44, 0.8, px, T + 3.7, cz, { bevel: 0.1 });
  st.cyl('hullSecondary', 0.3, 0.3, 0.14, px, T + 4.14, cz, { segs: 14 });
  const ram = new THREE.Group();
  const block = partMesh(boxGeo(1.45, 0.7, 1.25, 0.08), roleMaterial('structure'));
  block.position.y = 0.35;
  ram.add(block);
  const shoe = partMesh(boxGeo(1.55, 0.12, 1.35, 0.03), roleMaterial('hullSecondary'));
  shoe.position.y = 0.06;
  ram.add(shoe);
  ram.add(cylPart('hullSecondary', 0.17, 0.17, 2.5, 0.7, 12));
  ram.add(cylPart('structure', 0.28, 0.28, 0.14, 3.2));
  ram.position.set(px, T + 1.9, cz);
  ram.userData.baseY = ram.position.y;
  const inTrays: TraySpot[] = [
    { x: -2.9, y: T, z: 1.75, w: 1.5, d: 1.05 },
    { x: -1.15, y: T, z: 1.75, w: 1.5, d: 1.05 },
  ];
  const outTrays: TraySpot[] = [{ x: px, y: T, z: 1.75, w: 1.6, d: 1.05 }];
  trays(st, inTrays);
  trays(st, outTrays);
  const bulb = lampPost(st, px + 1.05, T + 3.9, cz - 0.5);
  return finish('fabricator', st, wb, bulb, { inTrays, outTrays, parts: { ram } });
}

function generic(type: BuildingTypeId): BuildingModel {
  const def = BUILDINGS[type];
  const st = new Builder();
  pad(st, def.w, def.d);
  st.box('hull', def.w * 0.8, 2, def.d * 0.7, 0, PAD_TOP, -def.d * 0.1, { bevel: 0.15 });
  const bulb = lampPost(st, 0, PAD_TOP + 2, -def.d * 0.2);
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
