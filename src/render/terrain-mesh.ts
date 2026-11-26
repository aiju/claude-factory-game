// The ground: one mesh from the heightfield, coloured per vertex, plus a flat
// skirt out to the fog so the map edge is never a cliff into nothing.

import * as THREE from 'three';
import { ITEM_IDS, type ItemId } from '../data/items';
import { fbm, smoothstep } from '../sim/noise';
import { Rng } from '../sim/rng';
import { heightAt, type Terrain } from '../sim/terrain';
import { ITEM_COLOURS, PALETTE } from './palette';
import { itemMaterial, makeItemGeometry } from './items';

export function createTerrainMesh(t: Terrain): THREE.Group {
  const group = new THREE.Group();
  const n = t.n;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const ground = new THREE.Color(PALETTE.ground);
  const cool = new THREE.Color(PALETTE.groundCool);
  const dry = new THREE.Color(PALETTE.groundDry);
  const cliff = new THREE.Color(PALETTE.cliff);
  const cliffDark = new THREE.Color(PALETTE.cliffShadow);
  const tmp = new THREE.Color();
  const depCols = t.map.deposits.map((d) => new THREE.Color(ITEM_COLOURS[d.item]));
  const seed = t.map.seed;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const h = t.heights[k];
      pos[k * 3] = i;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = j;
      // Local slope from neighbouring samples.
      const hx = t.heights[j * n + Math.min(n - 1, i + 1)] - t.heights[j * n + Math.max(0, i - 1)];
      const hz = t.heights[Math.min(n - 1, j + 1) * n + i] - t.heights[Math.max(0, j - 1) * n + i];
      const slope = Math.hypot(hx, hz) * 0.5;
      // Ground variation: a broad cool/dry drift and some small patches.
      const v = fbm(i, j, seed + 501, 60, 3);
      const p = fbm(i, j, seed + 733, 12, 2);
      tmp.copy(ground);
      if (v < 0) tmp.lerp(cool, Math.min(1, -v * 1.6));
      else tmp.lerp(dry, Math.min(1, v * 1.3) * 0.7);
      tmp.lerp(dry, smoothstep(0.2, 0.7, p) * 0.25);
      const rockiness = smoothstep(0.5, 1.1, slope);
      if (rockiness > 0) {
        const rc = cliff.clone().lerp(cliffDark, smoothstep(1.4, 2.6, slope) * 0.6);
        tmp.lerp(rc, rockiness);
      }
      // Deposits tint the ground beneath them, with a soft edge.
      t.map.deposits.forEach((d, di) => {
        const dd = Math.hypot(i - d.x, j - d.z);
        if (dd < d.r + 3) {
          const w = (1 - smoothstep(d.r * 0.5, d.r + 3, dd)) * 0.45;
          tmp.lerp(depCols[di], w);
        }
      });
      col[k * 3] = tmp.r;
      col[k * 3 + 1] = tmp.g;
      col[k * 3 + 2] = tmp.b;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  group.add(mesh);

  // Skirt: four flat slabs around the map, at the level the edge settles to.
  const skirtMat = new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 });
  const S = t.size;
  const F = 2000;
  for (const [x0, z0, x1, z1] of [
    [-F, -F, S + F, 0],
    [-F, S, S + F, S + F],
    [-F, 0, 0, S],
    [S, 0, S + F, S],
  ]) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, skirtMat);
    m.position.set((x0 + x1) / 2, t.map.baseHeight, (z0 + z1) / 2);
    m.receiveShadow = true;
    group.add(m);
  }

  group.add(createDepositScatter(t));
  return group;
}

/** Loose chunks of the raw item lying on each deposit. */
function createDepositScatter(t: Terrain): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(t.map.seed ^ 0x9e3779b9);
  const byItem = new Map<ItemId, THREE.Matrix4[]>();
  const m = new THREE.Matrix4();
  const qt = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const d of t.map.deposits) {
    const count = Math.round(d.r * d.r * 2.2);
    const list = byItem.get(d.item) ?? [];
    for (let i = 0; i < count; i++) {
      const a = rng.next() * Math.PI * 2;
      const rr = Math.sqrt(rng.next()) * d.r;
      const x = d.x + Math.cos(a) * rr;
      const z = d.z + Math.sin(a) * rr;
      const s = rng.range(2.2, 5.0) * (1 - (rr / d.r) * 0.55);
      e.set(rng.next() * 6, rng.next() * 6, rng.next() * 6);
      qt.setFromEuler(e);
      m.compose(new THREE.Vector3(x, heightAt(t, x, z) - 0.06 * s, z), qt, new THREE.Vector3(s, s * 0.8, s));
      list.push(m.clone());
    }
    byItem.set(d.item, list);
  }
  for (const item of ITEM_IDS) {
    const list = byItem.get(item);
    if (!list) continue;
    const im = new THREE.InstancedMesh(makeItemGeometry(item), itemMaterial(item), list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = true;
    im.receiveShadow = true;
    g.add(im);
  }
  return g;
}
