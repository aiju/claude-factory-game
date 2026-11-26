// Everything that grows or lies on the ground.
//
// Trees and boulders come from the sim (terrain.scenery): they block haulers
// and vanish when building clears them. The rest is dressing generated here
// from the map seed: shrubs, grass tufts, loose stones, and the slabs and ore
// that mark a deposit. Dressing is hidden wherever a building or its dock sits.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ItemId } from '../data/items';
import { buildingBody, buildingDock } from '../sim/build';
import { aabb, inflate, toLocal, type OBB } from '../sim/geom';
import { hash2, Rng } from '../sim/rng';
import { cellSlope, forestAt, heightAt, type Terrain } from '../sim/terrain';
import type { Sim } from '../sim/world';
import { itemMaterial, makeItemGeometry } from './items';
import { PALETTE } from './palette';
import { groundAt } from './terrain-mesh';

// --- Geometry --------------------------------------------------------------

/** Flat-shaded, with a colour per vertex chosen by `pick(position, faceIndex)`. */
function faceted(g: THREE.BufferGeometry, pick: (p: THREE.Vector3, face: number) => THREE.Color): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position') out.deleteAttribute(k);
  out.computeVertexNormals();
  const pos = out.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const c = pick(p, Math.floor(i / 3));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** Push every vertex in or out a little, the same way for coincident vertices. */
function roughen(g: THREE.BufferGeometry, amount: number, seed: number, only?: (p: THREE.Vector3) => boolean): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (only && !only(p)) continue;
    const key = Math.round(p.x * 100) * 7 + Math.round(p.y * 100) * 131 + Math.round(p.z * 100) * 1009;
    const f = 1 + (hash2(key, 1, seed) - 0.5) * 2 * amount;
    const dy = (hash2(key, 2, seed) - 0.5) * amount;
    pos.setXYZ(i, p.x * f, p.y + dy, p.z * f);
  }
  return g;
}

const C = (hex: number) => new THREE.Color(hex);

/** A spruce about 7 m tall: slender, with many ragged, drooping tiers. */
function conifer(seed: number): THREE.BufferGeometry {
  const bark = C(PALETTE.bark);
  const dark = C(PALETTE.foliage);
  const light = C(PALETTE.foliageLight);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.07, 0.2, 4.0, 6);
  trunk.translate(0, 2.0, 0);
  parts.push(faceted(trunk, () => bark));
  const tiers = 7;
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const y = 1.1 + f * 4.5;
    const r = (1.4 - 1.08 * f) * (0.85 + 0.3 * hash2(k, 1, seed));
    const h = 1.5 - 0.35 * f;
    const cone = new THREE.ConeGeometry(r, h, 7, 1);
    // Ragged, drooping skirt.
    roughen(cone, 0.3, seed + k * 17, (p) => p.y < -h / 2 + 0.01 && Math.hypot(p.x, p.z) > 0.01);
    const pos = cone.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -h / 2 + 0.2 && Math.hypot(pos.getX(i), pos.getZ(i)) > 0.01) pos.setY(i, pos.getY(i) - 0.28);
    cone.rotateY(hash2(k, 3, seed) * 6);
    // Tiers stay on the trunk's axis: a spruce is ragged in outline but dead straight.
    cone.translate(0, y + h / 2, 0);
    const base = dark.clone().lerp(light, f * 0.9);
    // Undersides sit in shade.
    parts.push(faceted(cone, (p, face) => base.clone().multiplyScalar((0.8 + 0.4 * hash2(face, k, seed + 9)) * (p.y < y + 0.05 ? 0.6 : 1))));
  }
  return mergeGeometries(parts)!;
}

/** A dead tree: a tapering trunk with a few broken limbs. */
function snag(seed: number): THREE.BufferGeometry {
  const wood = C(PALETTE.deadwood);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.05, 0.22, 5.4, 6);
  trunk.translate(0, 2.7, 0);
  parts.push(trunk);
  for (let k = 0; k < 4; k++) {
    const len = 0.7 + hash2(k, 1, seed) * 0.9;
    const limb = new THREE.CylinderGeometry(0.02, 0.06, len, 5);
    limb.translate(0, len / 2, 0);
    limb.rotateZ(0.9 + hash2(k, 2, seed) * 0.5);
    limb.rotateY(k * 1.7 + hash2(k, 3, seed));
    limb.translate(0, 2.0 + k * 0.75, 0);
    parts.push(limb);
  }
  return faceted(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    return g;
  }))!, (_p, face) => wood.clone().multiplyScalar(0.85 + 0.3 * hash2(face, 7, seed)));
}

/** An angular rock about 1 m across, sitting on y = 0. */
function boulder(seed: number, squash = 0.7): THREE.BufferGeometry {
  const rock = C(PALETTE.rock);
  const g = roughen(new THREE.DodecahedronGeometry(0.5, 0), 0.24, seed);
  g.scale(1, squash, 0.86);
  g.translate(0, 0.5 * squash * 0.55, 0);
  return faceted(g, (p, face) => rock.clone().multiplyScalar((0.74 + 0.4 * hash2(face, 3, seed)) * (0.82 + 0.3 * Math.min(1, p.y + 0.5))));
}

function shrub(seed: number): THREE.BufferGeometry {
  const leaf = C(PALETTE.shrub);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const r = 0.26 + hash2(k, 1, seed) * 0.2;
    const blob = roughen(new THREE.IcosahedronGeometry(r, 0), 0.28, seed + k);
    blob.scale(1, 0.72, 1);
    blob.translate((hash2(k, 2, seed) - 0.5) * 0.6, r * 0.5, (hash2(k, 3, seed) - 0.5) * 0.6);
    parts.push(blob);
  }
  return faceted(mergeGeometries(parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    n.deleteAttribute('normal');
    return n;
  }))!, (p, face) => leaf.clone().multiplyScalar((0.7 + 0.4 * hash2(face, 5, seed)) * (0.75 + 0.6 * Math.min(1, p.y * 1.6))));
}

/** A clump of grass: a few thin blades, dark at the root and dry at the tip. */
function tuft(seed: number): THREE.BufferGeometry {
  const root = C(PALETTE.grassBlade);
  const tip = C(PALETTE.grassTip);
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = hash2(k, 1, seed) * Math.PI * 2;
    const h = 0.22 + hash2(k, 2, seed) * 0.26;
    const lean = 0.06 + hash2(k, 3, seed) * 0.16;
    const bx = Math.cos(a) * 0.07, bz = Math.sin(a) * 0.07;
    const ox = (hash2(k, 4, seed) - 0.5) * 0.22, oz = (hash2(k, 5, seed) - 0.5) * 0.22;
    const tc = tip.clone().lerp(root, hash2(k, 6, seed) * 0.5);
    const A = [ox - bz * 0.45, 0, oz + bx * 0.45], B = [ox + bz * 0.45, 0, oz - bx * 0.45], T2 = [ox + Math.cos(a) * lean, h, oz + Math.sin(a) * lean];
    // Both windings, so a blade shows from either side without flipping its normal.
    pos.push(...A, ...B, ...T2, ...B, ...A, ...T2);
    for (let side = 0; side < 2; side++) {
      col.push(root.r, root.g, root.b, root.r, root.g, root.b, tc.r, tc.g, tc.b);
      // Lit like the ground it grows from, so blades don't flicker.
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// --- Instanced layers ------------------------------------------------------

interface Item {
  x: number;
  z: number;
  m: THREE.Matrix4;
  tint?: THREE.Color;
  /** Index into terrain.scenery, for things the sim owns. */
  solid?: number;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class Layer {
  readonly mesh: THREE.InstancedMesh;
  private shown: Uint8Array;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly items: Item[], shadows: boolean) {
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    this.mesh.count = items.length;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.shown = new Uint8Array(items.length).fill(1);
    items.forEach((it, k) => {
      this.mesh.setMatrixAt(k, it.m);
      if (it.tint) this.mesh.setColorAt(k, it.tint);
    });
  }

  mask(hidden: (it: Item) => boolean) {
    let changed = false;
    this.items.forEach((it, k) => {
      const show = hidden(it) ? 0 : 1;
      if (show !== this.shown[k]) {
        this.shown[k] = show;
        this.mesh.setMatrixAt(k, show ? it.m : ZERO);
        changed = true;
      }
    });
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const q = new THREE.Quaternion();
const e = new THREE.Euler();

function place(t: Terrain, x: number, z: number, sx: number, sy: number, sz: number, yaw: number, sink = 0.04, tilt = 0): THREE.Matrix4 {
  e.set(tilt * Math.sin(yaw * 3.1), yaw, tilt * Math.cos(yaw * 2.3), 'YXZ');
  q.setFromEuler(e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(t, x, z) - sink, z), q, new THREE.Vector3(sx, sy, sz));
}

function slopeAt(t: Terrain, x: number, z: number): number {
  return cellSlope(t, Math.max(0, Math.min(t.size - 1, Math.floor(x))), Math.max(0, Math.min(t.size - 1, Math.floor(z))));
}

export class SceneryView {
  readonly group = new THREE.Group();
  private solid: Layer[] = [];
  private dressing: Layer[] = [];
  private signature = '';

  constructor(private sim: Sim) {
    const t = sim.d.terrain;
    const seed = t.map.seed ^ 0x7ee5;
    const nature = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const blades = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const add = (list: Layer[], geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], shadows = true) => {
      if (!items.length) return;
      const l = new Layer(geo, mat, items, shadows);
      list.push(l);
      this.group.add(l.mesh);
    };

    // Trees and boulders, from the sim.
    const trees: Item[][] = [[], [], []];
    const snags: Item[] = [];
    const boulders: Item[][] = [[], []];
    t.scenery.forEach((s, k) => {
      const v = hash2(k, 1, seed);
      if (s.kind === 'tree') {
        const tint = new THREE.Color(0.82 + 0.3 * v, 0.86 + 0.24 * hash2(k, 2, seed), 0.84 + 0.22 * hash2(k, 3, seed));
        trees[k % 3].push({ x: s.x, z: s.z, m: place(t, s.x, s.z, s.s * (0.9 + 0.2 * v), s.s, s.s * (0.9 + 0.2 * v), s.rot, 0.1, 0.012), tint, solid: k });
      } else if (s.kind === 'snag') {
        snags.push({ x: s.x, z: s.z, m: place(t, s.x, s.z, s.s, s.s, s.s, s.rot, 0.1, 0.1), solid: k });
      } else {
        const g = 0.82 + 0.3 * v;
        boulders[k % 2].push({ x: s.x, z: s.z, m: place(t, s.x, s.z, s.s, s.s * (0.8 + 0.5 * v), s.s, s.rot, 0.08 * s.s, 0.2), tint: new THREE.Color(g, g, g * 0.98), solid: k });
      }
    });
    trees.forEach((items, k) => add(this.solid, conifer(seed + k * 101), nature, items));
    add(this.solid, snag(seed + 5), nature, snags);
    boulders.forEach((items, k) => add(this.solid, boulder(seed + 40 + k), nature, items));

    // Dressing.
    const rng = new Rng(seed);
    const shrubs: Item[] = [];
    const stones: Item[] = [];
    const tufts: Item[][] = [[], []];
    const size = t.size;
    for (let j = 0; j * 1.4 < size; j++) {
      for (let i = 0; i * 1.4 < size; i++) {
        const x = (i + hash2(i, j, seed + 20)) * 1.4;
        const z = (j + hash2(i, j, seed + 21)) * 1.4;
        if (x < 2 || z < 2 || x > size - 2 || z > size - 2) continue;
        const g = groundAt(t, x, z);
        if (g.rock > 0.25 || slopeAt(t, x, z) > 0.5) continue;
        if (hash2(i, j, seed + 22) > (1 - g.dirt) * 0.7 + 0.04) continue;
        const s = 0.8 + hash2(i, j, seed + 23) * 0.9;
        const dry = 0.8 + 0.4 * hash2(i, j, seed + 24);
        tufts[(i + j) % 2].push({ x, z, m: place(t, x, z, s, s, s, hash2(i, j, seed + 25) * 6.3, 0.02), tint: new THREE.Color(dry, 0.9 + 0.2 * hash2(i, j, seed + 26), 0.85) });
      }
    }
    for (let j = 0; j * 4 < size; j++) {
      for (let i = 0; i * 4 < size; i++) {
        const x = (i + hash2(i, j, seed + 30)) * 4;
        const z = (j + hash2(i, j, seed + 31)) * 4;
        if (x < 3 || z < 3 || x > size - 3 || z > size - 3) continue;
        const g = groundAt(t, x, z);
        const slope = slopeAt(t, x, z);
        const wooded = forestAt(t.map, x, z);
        const hubD = Math.hypot(x - t.map.hub.x, z - t.map.hub.z);
        // Shrubs like forest edges; they stay off bare ground and rock.
        if (g.rock < 0.15 && g.dirt < 0.5 && slope < 0.4 && hubD > 16 && hash2(i, j, seed + 32) < 0.14 + Math.max(0, 0.35 - Math.abs(wooded - 0.05) * 3)) {
          const s = 0.7 + hash2(i, j, seed + 33) * 0.9;
          const v = 0.8 + 0.3 * hash2(i, j, seed + 34);
          shrubs.push({ x, z, m: place(t, x, z, s, s * (0.8 + 0.4 * v), s, hash2(i, j, seed + 35) * 6.3), tint: new THREE.Color(v, v * 1.02, v * 0.9) });
        }
        // Loose stones gather on bare and broken ground.
        if (g.rock < 0.2 && hash2(i, j, seed + 36) < 0.1 + g.dirt * 0.25 + Math.min(0.5, slope)) {
          const x2 = x + (hash2(i, j, seed + 37) - 0.5) * 3;
          const z2 = z + (hash2(i, j, seed + 38) - 0.5) * 3;
          const s = 0.18 + hash2(i, j, seed + 39) * 0.42;
          const v = 0.8 + 0.3 * hash2(i, j, seed + 40);
          stones.push({ x: x2, z: z2, m: place(t, x2, z2, s, s, s, hash2(i, j, seed + 41) * 6.3, 0.03 * s, 0.4), tint: new THREE.Color(v, v, v) });
        }
      }
    }
    // Deposits: low slabs of country rock, with lumps of ore among them.
    const slabs: Item[] = [];
    const ore = new Map<ItemId, Item[]>();
    for (const d of t.map.deposits) {
      const lumps = ore.get(d.item) ?? [];
      ore.set(d.item, lumps);
      const nSlabs = Math.round(d.r * d.r * 0.9);
      for (let k = 0; k < nSlabs; k++) {
        const a = rng.next() * Math.PI * 2;
        const rr = Math.sqrt(rng.next()) * d.r * 1.05;
        const x = d.x + Math.cos(a) * rr;
        const z = d.z + Math.sin(a) * rr;
        const w = rng.range(0.6, 1.7) * (1 - (rr / d.r) * 0.3);
        const v = rng.range(0.78, 1.1);
        slabs.push({ x, z, m: place(t, x, z, w, w * rng.range(0.22, 0.42), w * rng.range(0.7, 1.1), rng.next() * 6.3, 0.05, 0.12), tint: new THREE.Color(v, v, v) });
        // Ore breaks out around each slab.
        const n = 1 + Math.floor(rng.next() * 4);
        for (let c = 0; c < n; c++) {
          const b = rng.next() * Math.PI * 2;
          const ox = x + Math.cos(b) * w * rng.range(0.45, 0.9);
          const oz = z + Math.sin(b) * w * rng.range(0.45, 0.9);
          const s = rng.range(0.8, 2.0);
          e.set(rng.next() * 6, rng.next() * 6, rng.next() * 6);
          q.setFromEuler(e);
          lumps.push({ x: ox, z: oz, m: new THREE.Matrix4().compose(new THREE.Vector3(ox, heightAt(t, ox, oz) - 0.04 * s, oz), q, new THREE.Vector3(s, s * 0.8, s)) });
        }
      }
    }
    add(this.dressing, shrub(seed + 60), nature, shrubs);
    add(this.dressing, boulder(seed + 61, 0.6), nature, stones);
    add(this.dressing, boulder(seed + 62, 0.75), nature, slabs);
    tufts.forEach((items, k) => add(this.dressing, tuft(seed + 70 + k), blades, items, false));
    for (const [item, lumps] of ore) add(this.dressing, makeItemGeometry(item), itemMaterial(item), lumps);
    this.update();
  }

  setSim(sim: Sim) {
    this.sim = sim;
    this.signature = '';
    this.update();
  }

  /** Cheap unless buildings or cleared scenery have changed. */
  update() {
    const st = this.sim.state;
    let sum = 0;
    for (const b of st.buildings) sum = (sum * 31 + b.id) | 0;
    const signature = `${st.cleared.length}:${st.buildings.length}:${sum}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const gone = new Set(st.cleared);
    for (const l of this.solid) l.mask((it) => gone.has(it.solid!));
    // Rasterise footprints and docks to a 1 m grid, then look dressing up in it.
    const n = this.sim.d.terrain.size;
    const covered = new Uint8Array(n * n);
    const stamp = (o: OBB) => {
      const a = aabb(o);
      for (let j = Math.max(0, Math.floor(a.z0)); j <= Math.min(n - 1, Math.floor(a.z1)); j++) {
        for (let i = Math.max(0, Math.floor(a.x0)); i <= Math.min(n - 1, Math.floor(a.x1)); i++) {
          const [lx, lz] = toLocal(o.cx, o.cz, o.rot, i + 0.5, j + 0.5);
          if (Math.abs(lx) <= o.hx + 0.5 && Math.abs(lz) <= o.hz + 0.5) covered[j * n + i] = 1;
        }
      }
    };
    for (const b of st.buildings) {
      stamp(inflate(buildingBody(b), 0.5));
      const dock = buildingDock(b);
      if (dock) stamp(inflate(dock, 0.2));
    }
    const under = (it: Item) => {
      const i = Math.floor(it.x), j = Math.floor(it.z);
      return i >= 0 && j >= 0 && i < n && j < n && covered[j * n + i] === 1;
    };
    for (const l of this.dressing) l.mask(under);
  }
}
