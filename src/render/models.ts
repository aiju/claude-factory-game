// Building meshes, composed from the model kit. Local frame: +Z is the front
// (the dock side), Y up, origin at the plinth's base height.

import * as THREE from 'three';
import { BUILDINGS, type BuildingTypeId } from '../data/buildings';
import { Builder, boxGeo, glowMaterial, kitMaterial, partMesh, roleMaterial } from './kit';

export const PLINTH_TOP = 0.3;

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

function plinth(st: Builder, w: number, d: number) {
  st.box('structure', w, 1.9 + PLINTH_TOP - 0.3, d, 0, -1.6, 0, { bevel: 0.1 });
}

/** Windows: thin panels on a face. `face` is the outward direction in local XZ. */
function windowPanels(wb: Builder, list: { x: number; y: number; z: number; w: number; h: number; face: 'front' | 'left' | 'right' | 'back' }[]) {
  for (const p of list) {
    const rotY = p.face === 'front' ? 0 : p.face === 'back' ? Math.PI : p.face === 'left' ? -Math.PI / 2 : Math.PI / 2;
    wb.box('structure', p.w, p.h, 0.06, p.x, p.y, p.z, { bevel: 0.015, rotY });
  }
}

function lampPost(st: Builder, x: number, y: number, z: number): THREE.Mesh {
  st.cyl('structure', 0.05, 0.05, 0.45, x, y, z, { segs: 8 });
  st.cyl('structure', 0.16, 0.18, 0.08, x, y + 0.45, z, { segs: 12 });
  const bulb = partMesh(new THREE.SphereGeometry(0.15, 14, 10), glowMaterial('hullSecondary', 'hazard', 0));
  bulb.position.set(x, y + 0.6, z);
  bulb.castShadow = false;
  return bulb;
}

function pulseRim(t: TraySpot): THREE.Mesh {
  const b = new Builder();
  const r = 0.07;
  const h = 0.05;
  const y = t.y + 0.19;
  b.box('hazard', t.w + 0.08, h, r, t.x, y, t.z - t.d / 2 - 0.0, { bevel: 0 });
  b.box('hazard', t.w + 0.08, h, r, t.x, y, t.z + t.d / 2 + 0.0, { bevel: 0 });
  b.box('hazard', r, h, t.d, t.x - t.w / 2 - 0.0, y, t.z, { bevel: 0 });
  b.box('hazard', r, h, t.d, t.x + t.w / 2 + 0.0, y, t.z, { bevel: 0 });
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

function trays(st: Builder, list: TraySpot[], role: 'structure' | 'hullSecondary' = 'structure') {
  for (const t of list) st.tray(role, t.w, t.d, t.x, t.y, t.z);
}

function hub(): BuildingModel {
  const def = BUILDINGS.hub;
  const st = new Builder();
  const wb = new Builder();
  const T = PLINTH_TOP;
  plinth(st, def.w, def.d);
  // Main hall.
  st.box('hull', 13, 2.8, 6.4, 0, T, -1.1, { bevel: 0.14 });
  st.box('logistics', 13.04, 0.22, 6.44, 0, T + 1.9, -1.1, { bevel: 0.03 });
  st.box('hullSecondary', 13.1, 0.22, 6.5, 0, T + 2.8, -1.1, { bevel: 0.05 });
  // Upper block.
  st.box('hull', 4.6, 1.5, 3.8, -3.6, T + 3.0, -1.8, { bevel: 0.12 });
  // Hauler bays: recessed doors along the front.
  for (const x of [-4.8, -1.6, 1.6, 4.8]) {
    st.box('structure', 2.4, 1.7, 0.08, x, T, 2.1, { bevel: 0.02 });
    st.box('hullSecondary', 2.6, 0.12, 0.3, x, T + 1.7, 2.15, { bevel: 0.02 });
  }
  windowPanels(wb, [
    { x: -4.6, y: T + 3.55, z: 0.13, w: 0.9, h: 0.45, face: 'front' },
    { x: -3.5, y: T + 3.55, z: 0.13, w: 0.9, h: 0.45, face: 'front' },
    { x: -2.4, y: T + 3.55, z: 0.13, w: 0.9, h: 0.45, face: 'front' },
  ]);
  // Storage bins on the roof, one per item.
  const roof = T + 3.02;
  const bins: TraySpot[] = [];
  for (let k = 0; k < 6; k++) {
    bins.push({ x: 0.9 + (k % 3) * 1.6, y: roof, z: -2.7 + Math.floor(k / 3) * 1.6, w: 1.25, d: 1.25 });
  }
  trays(st, bins, 'hullSecondary');
  // Mast and dish.
  const mx = -5.4;
  const mz = -3.4;
  st.cyl('structure', 0.1, 0.14, 2.6, mx, T + 4.5, mz, { segs: 10 });
  const dish = new THREE.Group();
  dish.position.set(mx, T + 7.1, mz);
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
  const bulb = lampPost(st, 5.9, T + 2.8, -3.9);
  return finish('hub', st, wb, bulb, { bins, parts: { dish } });
}

function extractor(): BuildingModel {
  const st = new Builder();
  const wb = new Builder();
  const T = PLINTH_TOP;
  plinth(st, 4, 4);
  const cz = -0.55;
  st.box('hull', 3.3, 1.1, 2.7, 0, T, cz, { bevel: 0.1 });
  st.box('logistics', 3.34, 0.16, 2.74, 0, T + 0.75, cz, { bevel: 0.02 });
  // Tower legs.
  for (const [x, z] of [[-1.15, cz - 0.95], [1.15, cz - 0.95], [-1.15, cz + 0.95], [1.15, cz + 0.95]]) {
    st.box('structure', 0.2, 3.2, 0.2, x, T + 1.1, z, { bevel: 0.03 });
  }
  st.box('structure', 2.6, 0.14, 0.16, 0, T + 2.6, cz - 0.95, { bevel: 0.02 });
  st.box('structure', 2.6, 0.14, 0.16, 0, T + 2.6, cz + 0.95, { bevel: 0.02 });
  // Head housing.
  st.box('hull', 2.8, 0.95, 2.5, 0, T + 4.3, cz, { bevel: 0.1 });
  st.box('structure', 0.9, 0.1, 0.9, 0, T + 1.1, cz, { bevel: 0.02 });
  windowPanels(wb, [
    { x: -0.55, y: T + 4.55, z: cz + 1.26, w: 0.55, h: 0.35, face: 'front' },
    { x: 0.15, y: T + 4.55, z: cz + 1.26, w: 0.55, h: 0.35, face: 'front' },
  ]);
  const piston = new THREE.Group();
  const rod = partMesh(new THREE.CylinderGeometry(0.32, 0.32, 2.4, 16), roleMaterial('structure'));
  rod.position.y = 1.2;
  piston.add(rod);
  const collar = partMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.2, 16), roleMaterial('hullSecondary'));
  collar.position.y = 0.3;
  piston.add(collar);
  piston.position.set(0, T + 1.9, cz);
  piston.userData.baseY = piston.position.y;
  const outTrays: TraySpot[] = [{ x: 0.75, y: T, z: 1.4, w: 1.6, d: 1.05 }];
  trays(st, outTrays);
  const bulb = lampPost(st, 1.1, T + 5.25, cz - 0.8);
  return finish('extractor', st, wb, bulb, { outTrays, parts: { piston } });
}

function smelter(): BuildingModel {
  const st = new Builder();
  const wb = new Builder();
  const T = PLINTH_TOP;
  plinth(st, 5, 5);
  const cz = -0.75;
  st.box('hull', 4.5, 2.7, 3.3, 0, T, cz, { bevel: 0.14 });
  st.box('logistics', 4.54, 0.18, 3.34, 0, T + 2.2, cz, { bevel: 0.02 });
  st.box('hullSecondary', 4.6, 0.16, 3.4, 0, T + 2.7, cz, { bevel: 0.04 });
  // Stack.
  st.cyl('structure', 0.36, 0.46, 5.8, -1.35, T + 2.7, cz - 0.7, { segs: 18 });
  st.cyl('hullSecondary', 0.48, 0.48, 0.22, -1.35, T + 6.6, cz - 0.7, { segs: 18 });
  // Mouth: a dark frame with a glowing panel set in it.
  const mz = cz + 1.65;
  st.box('structure', 1.6, 1.25, 0.12, 0.75, T + 0.35, mz, { bevel: 0.03 });
  const glow = glowMaterial('structure', 'furnaceGlow', 0);
  const mouth = partMesh(boxGeo(1.2, 0.85, 0.06, 0.02), glow);
  mouth.position.set(0.75, T + 0.35 + 0.2 + 0.42, mz + 0.05);
  mouth.castShadow = false;
  windowPanels(wb, [
    { x: -1.5, y: T + 1.55, z: mz + 0.01, w: 0.6, h: 0.35, face: 'front' },
    { x: -0.75, y: T + 1.55, z: mz + 0.01, w: 0.6, h: 0.35, face: 'front' },
  ]);
  const inTrays: TraySpot[] = [{ x: -1.3, y: T, z: 1.75, w: 1.6, d: 1.05 }];
  const outTrays: TraySpot[] = [{ x: 1.3, y: T, z: 1.75, w: 1.6, d: 1.05 }];
  trays(st, inTrays);
  trays(st, outTrays);
  const bulb = lampPost(st, 1.7, T + 2.85, cz - 1.2);
  return finish('smelter', st, wb, bulb, {
    inTrays,
    outTrays,
    parts: { mouth },
    glow,
    smokeAt: new THREE.Vector3(-1.35, T + 6.85, cz - 0.7),
  });
}

function fabricator(): BuildingModel {
  const st = new Builder();
  const wb = new Builder();
  const T = PLINTH_TOP;
  plinth(st, 8, 5);
  const cz = -0.8;
  st.box('hull', 7.6, 2.3, 3.1, 0, T, cz, { bevel: 0.14 });
  st.box('logistics', 7.64, 0.18, 3.14, 0, T + 1.75, cz, { bevel: 0.02 });
  st.box('hullSecondary', 7.7, 0.16, 3.2, 0, T + 2.3, cz, { bevel: 0.04 });
  // Raised press housing: four posts, a cap, a die block.
  const px = 1.4;
  const top = T + 2.46;
  for (const [x, z] of [[px - 1.1, cz - 0.9], [px + 1.1, cz - 0.9], [px - 1.1, cz + 0.9], [px + 1.1, cz + 0.9]]) {
    st.box('structure', 0.22, 2.0, 0.22, x, top, z, { bevel: 0.03 });
  }
  st.box('hull', 2.7, 0.7, 2.3, px, top + 2.0, cz, { bevel: 0.1 });
  st.box('hullSecondary', 1.4, 0.3, 1.2, px, top, cz, { bevel: 0.04 });
  const ram = new THREE.Group();
  const rh = partMesh(boxGeo(1.2, 0.6, 1.0, 0.05), roleMaterial('structure'));
  rh.position.y = 0.3;
  ram.add(rh);
  const rod = partMesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 10), roleMaterial('hullSecondary'));
  rod.position.y = 1.2;
  ram.add(rod);
  ram.position.set(px, top + 1.0, cz);
  ram.userData.baseY = ram.position.y;
  windowPanels(wb, [-3.1, -2.3, -1.5, -0.7].map((x) => ({ x, y: T + 1.15, z: cz + 1.56, w: 0.6, h: 0.4, face: 'front' as const })));
  const inTrays: TraySpot[] = [
    { x: -2.9, y: T, z: 1.75, w: 1.5, d: 1.05 },
    { x: -1.15, y: T, z: 1.75, w: 1.5, d: 1.05 },
  ];
  const outTrays: TraySpot[] = [{ x: 2.6, y: T, z: 1.75, w: 1.6, d: 1.05 }];
  trays(st, inTrays);
  trays(st, outTrays);
  const bulb = lampPost(st, -3.3, T + 2.46, cz - 1.1);
  return finish('fabricator', st, wb, bulb, { inTrays, outTrays, parts: { ram } });
}

function generic(type: BuildingTypeId): BuildingModel {
  const def = BUILDINGS[type];
  const st = new Builder();
  plinth(st, def.w, def.d);
  st.box('hull', def.w * 0.8, 2, def.d * 0.7, 0, PLINTH_TOP, -def.d * 0.1);
  const bulb = lampPost(st, 0, PLINTH_TOP + 2, -def.d * 0.2);
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
