// Draws the sim. Reads state; never writes it.

import * as THREE from 'three';
import { ITEM_IDS, type ItemId } from '../data/items';
import { RECIPES } from '../data/recipes';
import { craftTicks, recipeInputs } from '../sim/prod';
import type { Building, Slot } from '../sim/types';
import type { Sim } from '../sim/world';
import { buildDockMesh, buildOutline } from './dock';
import { Instancer } from './instancer';
import { ITEM_STACK_HEIGHT, itemMaterial, makeItemGeometry } from './items';
import { kitMaterial } from './kit';
import { HaulerView } from './haulers';
import { LinkView } from './links';
import { buildModel, type BuildingModel, type TraySpot } from './models';
import { PALETTE } from './palette';
import { SceneryView } from './scenery';
import { SMOKE, SmokeView } from './smoke';

interface BView {
  id: number;
  model: BuildingModel;
  dock: THREE.Mesh | null;
  glow: number;
  dishSpeed: number;
  smokeClock: number;
}

const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Clone a model template: geometry shared, per-instance materials copied. */
function cloneModel(t: BuildingModel): BuildingModel {
  const root = t.root.clone(true);
  const matMap = new Map<THREE.Material, THREE.Material>();
  const perInstance = [t.windows, t.lamp, t.glow, ...t.trayPulse.map((p) => p.material as THREE.Material)].filter(Boolean) as THREE.Material[];
  for (const m of perInstance) matMap.set(m, m.clone());
  const parts: Record<string, THREE.Object3D> = {};
  const trayPulse: THREE.Mesh[] = [];
  let body: THREE.Mesh = root.children[0] as THREE.Mesh;
  // Walk both trees in parallel to map template objects to clones.
  const walk = (a: THREE.Object3D, b: THREE.Object3D) => {
    if (a === t.body) body = b as THREE.Mesh;
    for (const [k, p] of Object.entries(t.parts)) if (p === a) parts[k] = b;
    const pi = t.trayPulse.indexOf(a as THREE.Mesh);
    if (pi >= 0) trayPulse[pi] = b as THREE.Mesh;
    if ((b as THREE.Mesh).isMesh) {
      const mesh = b as THREE.Mesh;
      const mm = matMap.get(mesh.material as THREE.Material);
      if (mm) mesh.material = mm;
    }
    a.children.forEach((c, i) => walk(c, b.children[i]));
  };
  walk(t.root, root);
  for (const p of Object.values(parts)) p.userData = { ...p.userData };
  return {
    ...t,
    root,
    body,
    parts,
    trayPulse,
    windows: matMap.get(t.windows) as THREE.MeshStandardMaterial,
    lamp: matMap.get(t.lamp) as THREE.MeshStandardMaterial,
    glow: t.glow ? (matMap.get(t.glow) as THREE.MeshStandardMaterial) : null,
  };
}

export class WorldView {
  readonly group = new THREE.Group();
  private views = new Map<number, BView>();
  private templates = new Map<string, BuildingModel>();
  private items = new Map<ItemId, Instancer>();
  private smoke = new SmokeView();
  readonly scenery: SceneryView;
  readonly haulers: HaulerView;
  readonly links: LinkView;
  private time = 0;
  /** Building id under selection, for a highlight. */
  selected: number | null = null;
  /** Building id the demolish tool is pointing at. */
  doomed: number | null = null;
  private outline: { key: string; mesh: THREE.Mesh } | null = null;

  constructor(private sim: Sim) {
    for (const item of ITEM_IDS) this.items.set(item, new Instancer(makeItemGeometry(item), itemMaterial(item), this.group, 256));
    this.group.add(this.smoke.mesh);
    this.scenery = new SceneryView(sim);
    this.group.add(this.scenery.group);
    this.haulers = new HaulerView(sim, this.group);
    this.links = new LinkView(sim);
    this.group.add(this.links.group);
  }

  setSim(sim: Sim) {
    for (const v of this.views.values()) this.removeView(v);
    this.views.clear();
    this.sim = sim;
    this.haulers.setSim(sim);
    this.links.setSim(sim);
    this.scenery.setSim(sim);
    this.smoke.clear();
  }

  pickableMeshes(): THREE.Object3D[] {
    return [...this.views.values()].map((v) => v.model.body);
  }

  template(type: Building['type']): BuildingModel {
    let t = this.templates.get(type);
    if (!t) this.templates.set(type, (t = buildModel(type)));
    return t;
  }

  private addView(b: Building): BView {
    const model = cloneModel(this.template(b.type));
    model.root.position.set(b.x, b.y, b.z);
    model.root.rotation.y = b.rot;
    model.body.userData.buildingId = b.id;
    model.root.updateMatrixWorld(true);
    this.group.add(model.root);
    const dock = buildDockMesh(this.sim.d.terrain, b.type, b.x, b.z, b.rot);
    if (dock) this.group.add(dock);
    const v: BView = { id: b.id, model, dock, glow: 0, dishSpeed: 0, smokeClock: 0 };
    this.views.set(b.id, v);
    return v;
  }

  private removeView(v: BView) {
    this.group.remove(v.model.root);
    if (v.dock) {
      this.group.remove(v.dock);
      v.dock.geometry.dispose();
    }
  }

  /** `alpha`: fraction into the next tick. `dt`: game-time seconds since last frame (0 when paused). */
  update(alpha: number, dt: number) {
    this.time += dt;
    const sim = this.sim;
    const seen = new Set<number>();
    for (const it of this.items.values()) it.begin();
    this.scenery.update();
    const busy = sim.state.jobs.length > 0;
    for (const b of sim.state.buildings) {
      seen.add(b.id);
      const v = this.views.get(b.id) ?? this.addView(b);
      this.animate(v, b, alpha, dt, busy);
      this.drawBuffers(v, b);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.removeView(v);
        this.views.delete(id);
      }
    }
    this.haulers.update(alpha, dt, this);
    this.links.update(alpha, dt, this);
    for (const it of this.items.values()) it.end();
    this.smoke.update(dt);
    this.updateOutline();
  }

  private updateOutline() {
    const id = this.doomed ?? this.selected;
    const b = id !== null ? this.sim.d.byId.get(id) : undefined;
    const key = b ? `${b.id}:${this.doomed !== null}` : '';
    if (this.outline?.key === key) return;
    if (this.outline) {
      this.group.remove(this.outline.mesh);
      this.outline.mesh.geometry.dispose();
      this.outline = null;
    }
    if (b) {
      const mesh = buildOutline(this.sim.d.terrain, b.type, b.x, b.z, b.rot, this.doomed !== null ? 'fault' : 'roadMark');
      this.group.add(mesh);
      this.outline = { key, mesh };
    }
  }

  /** Items for haulers etc. can be added between update calls by other views. */
  itemInstancer(item: ItemId): Instancer {
    return this.items.get(item)!;
  }

  private animate(v: BView, b: Building, alpha: number, dt: number, busy: boolean) {
    const m = v.model;
    const t = this.time;
    const phase = b.recipe && b.crafting ? Math.min(1, (b.progress + alpha) / craftTicks(RECIPES[b.recipe])) : 0;

    // Windows: lit while powered (always, until power exists).
    m.windows.emissiveIntensity = 0.9;

    // Lamp: amber blinking when starved, steady when blocked, off otherwise.
    let lamp = 0;
    if (b.status === 'starved') lamp = Math.sin(t * Math.PI * 2 * 0.6) > 0 ? 1.6 : 0;
    else if (b.status === 'blocked') lamp = 1.6;
    m.lamp.emissiveIntensity = lamp;
    m.lamp.color.setHex(lamp > 0 ? PALETTE.hazard : PALETTE.hullSecondary);

    // Starved: the empty tray's outline pulses.
    if (m.trayPulse.length && b.recipe) {
      const ins = recipeInputs(RECIPES[b.recipe]);
      m.trayPulse.forEach((p, i) => {
        const need = ins[i];
        const starving = b.status === 'starved' && need && (b.inp[need[0]]?.n ?? 0) < need[1];
        p.visible = !!starving;
        if (starving) (p.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.6));
      });
    }

    const piston = m.parts.piston;
    if (piston) {
      // Drive down fast, rise slowly.
      const p = phase < 0.3 ? phase / 0.3 : 1 - (phase - 0.3) / 0.7;
      const e = p * p * (3 - 2 * p);
      piston.position.y = piston.userData.baseY - e * 1.0;
    }
    const ram = m.parts.ram;
    if (ram) {
      // Three stamps per craft: quick down, settle, lift.
      const f = (phase * 3) % 1;
      const p = f < 0.18 ? f / 0.18 : f < 0.3 ? 1 : Math.max(0, 1 - (f - 0.3) / 0.5);
      ram.position.y = ram.userData.baseY - (b.crafting ? p * p * 0.68 : 0);
    }
    const dish = m.parts.dish;
    if (dish) {
      const target = busy ? 0.35 : 0;
      v.dishSpeed += (target - v.dishSpeed) * Math.min(1, dt * 1.5);
      dish.rotation.y += v.dishSpeed * dt;
    }
    if (m.glow) {
      const target = b.status === 'working' ? 1.8 : 0;
      v.glow += (target - v.glow) * Math.min(1, dt * 2.5);
      m.glow.emissiveIntensity = v.glow * (0.92 + 0.08 * Math.sin(t * 7.3) * Math.sin(t * 3.1));
    }
    if (m.smokeAt && b.status === 'working') {
      const kind = m.smokeKind === 'exhaust' ? SMOKE.exhaust : SMOKE.stack;
      const every = m.smokeKind === 'exhaust' ? 0.2 : 0.1;
      v.smokeClock += dt;
      while (v.smokeClock > every) {
        v.smokeClock -= every;
        tmpV.copy(m.smokeAt).applyMatrix4(m.root.matrixWorld);
        this.smoke.emit(tmpV, kind);
      }
    }
  }

  private drawBuffers(v: BView, b: Building) {
    const m = v.model;
    if (b.store) {
      ITEM_IDS.forEach((item, k) => {
        const s = b.store![item];
        if (s && s.n > 0 && m.bins[k]) this.stack(m, m.bins[k], item, Math.min(BIN_SHOWN, s.n));
      });
      return;
    }
    const ins = Object.entries(b.inp) as [ItemId, Slot][];
    ins.forEach(([item, s], i) => {
      const spot = m.inTrays[i];
      if (spot && s.n > 0) this.stack(m, spot, item, s.n);
    });
    const outs = Object.entries(b.out) as [ItemId, Slot][];
    outs.forEach(([item, s], i) => {
      const spot = m.outTrays[Math.min(i, m.outTrays.length - 1)];
      if (spot && s.n > 0) this.stack(m, spot, item, s.n, i);
    });
  }

  /** Lay out `n` items on a tray: as many per layer as fit, layers upward. */
  private stack(m: BuildingModel, spot: TraySpot, item: ItemId, n: number, shift = 0) {
    const inst = this.items.get(item)!;
    const h = ITEM_STACK_HEIGHT[item];
    const cols = Math.max(1, Math.floor((spot.w - 0.2) / STACK_PITCH));
    const rows = Math.max(1, Math.floor((spot.d - 0.2) / STACK_PITCH));
    const per = cols * rows;
    for (let k = 0; k < n; k++) {
      const layer = Math.floor(k / per);
      const c = (k + shift) % per;
      const lx = spot.x + ((c % cols) - (cols - 1) / 2) * STACK_PITCH;
      const lz = spot.z + (Math.floor(c / cols) - (rows - 1) / 2) * STACK_PITCH;
      const ly = spot.y + 0.05 + layer * h;
      const yaw = ((k * 2.399) % 1) * 0.5 - 0.25 + (layer % 2) * 0.3;
      tmpQ.setFromAxisAngle(UP, yaw);
      tmpV.set(lx, ly, lz);
      tmpS.set(1, 1, 1);
      tmpM2.compose(tmpV, tmpQ, tmpS);
      tmpM.multiplyMatrices(m.root.matrixWorld, tmpM2);
      inst.add(tmpM);
    }
  }
}

/** Spacing of items laid out on a tray, metres. */
const STACK_PITCH = 0.42;
/** Most items drawn in one hub bin; beyond this it just looks full. */
const BIN_SHOWN = 40;

export { kitMaterial };
