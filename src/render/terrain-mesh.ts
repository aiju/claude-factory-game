// The ground: one mesh from the heightfield plus a flat skirt out to the fog.
//
// Each vertex says what kind of ground it is (how grassy, how bare, how
// rocky, and what ore runs through the rock); the shader turns that into
// scrubby grass, dirt, cracked rock slabs and veins of ore. Steep ground is
// rock regardless.

import * as THREE from 'three';
import { fbm, smoothstep } from '../sim/noise';
import type { Terrain } from '../sim/terrain';
import { NOISE_GLSL } from './kit';
import { ITEM_COLOURS, PALETTE } from './palette';

/** Ground cover at a point: 0–1 bare dirt, 0–1 exposed rock (deposits). */
export function groundAt(t: Terrain, x: number, z: number): { dirt: number; rock: number; deposit: number } {
  const seed = t.map.seed;
  const patch = fbm(x, z, seed + 733, 26, 3);
  let dirt = smoothstep(0.24, 0.5, patch);
  let rock = 0;
  let deposit = -1;
  t.map.deposits.forEach((d, k) => {
    const dd = Math.hypot(x - d.x, z - d.z);
    if (dd > d.r * 1.3 + 3) return;
    // A ragged outline, not a circle.
    const edge = d.r * (0.95 + 0.3 * fbm(x, z, seed + 97 + k * 7, 7, 2));
    const m = 1 - smoothstep(edge - 1.5, edge + 2.5, dd);
    if (m > rock) {
      rock = m;
      deposit = k;
    }
  });
  // The hub's surroundings are trodden bare.
  const hd = Math.hypot(x - t.map.hub.x, z - t.map.hub.z);
  dirt = Math.max(dirt, (1 - smoothstep(8, 15, hd)) * 0.85);
  return { dirt, rock, deposit };
}

function gritty(mat: THREE.MeshStandardMaterial, perVertex: boolean): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDirt = { value: new THREE.Color(PALETTE.dirt) };
    shader.uniforms.uRock = { value: new THREE.Color(PALETTE.rock) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldP;
varying vec3 vKind;
varying vec3 vOre;
${perVertex ? 'attribute vec2 kind;\nattribute vec3 ore;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;
${perVertex ? 'vKind = vec3(kind, normal.y);\nvOre = ore;' : 'vKind = vec3(0.0, 0.0, 1.0);\nvOre = vec3(0.0);'}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uDirt;
uniform vec3 uRock;
varying vec3 vWorldP;
varying vec3 vKind;
varying vec3 vOre;
${NOISE_GLSL}
// Cellular pattern: distance to the nearest and second-nearest point, and an id for the nearest.
vec3 kCells(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(kHash(vec3(n + g, 1.0)), kHash(vec3(n + g, 2.0)));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; id = kHash(vec3(n + g, 5.0)); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vec3(vWorldP.x, 0.0, vWorldP.z);
  float broad = kNoise(p * 0.06) * 0.6 + kNoise(p * 0.27) * 0.4;
  float mid = kNoise(p * 1.7);
  float grain = kNoise(p * 21.0);
  float fine = kNoise(p * 7.0 + 31.7);

  // Scrubby grass: mottled, with dry clumps.
  vec3 grass = diffuseColor.rgb * (0.8 + 0.4 * broad) * (0.86 + 0.28 * mid) * (0.85 + 0.3 * grain);
  grass = mix(grass, grass * vec3(1.35, 1.25, 0.9), smoothstep(0.62, 0.8, fine) * 0.5);

  // Bare dirt, with a ragged edge and a scatter of small stones.
  float dirtM = smoothstep(0.3, 0.75, vKind.y + (mid - 0.5) * 0.6 + (fine - 0.5) * 0.3 + (grain - 0.5) * 0.3);
  vec3 dirt = uDirt * (0.84 + 0.3 * broad) * (0.9 + 0.2 * mid) * (0.9 + 0.2 * grain);
  dirt *= 1.0 - 0.22 * smoothstep(0.8, 0.9, fine);
  vec3 col = mix(grass, dirt, dirtM);

  // Rock: on steep ground, and where a deposit breaks the surface.
  float steep = smoothstep(0.9, 0.74, vKind.z);
  float outcrop = smoothstep(0.3, 0.62, vKind.x + (mid - 0.5) * 0.45);
  float rockM = max(steep, outcrop);
  // Irregular slabs: cells of a cellular pattern, each its own tone.
  vec3 cell = kCells(p.xz * 0.62 + vec2(kNoise(p * 0.4), kNoise(p * 0.4 + 17.0)) * 0.7);
  float edge = cell.y - cell.x;
  vec3 rock = uRock * (0.7 + 0.45 * cell.z) * (0.86 + 0.28 * grain) * (0.92 + 0.16 * mid);
  // Strata across cliff faces.
  float strata = kNoise(vec3(vWorldP.y * 2.4, p.x * 0.06, p.z * 0.06));
  rock = mix(rock, rock * (0.62 + 0.62 * strata), steep);
  // Joints between slabs. On a deposit they are wide and packed with ore;
  // elsewhere they are thin dark cracks.
  float lode = smoothstep(0.25, 0.6, vKind.x);
  float w = mix(0.045, 0.06 + 0.22 * kNoise(p * 0.45 + 40.0), lode);
  float joint = 1.0 - smoothstep(w * 0.55, w, edge);
  rock *= 0.72 + 0.28 * smoothstep(w, w + 0.14, edge);
  vec3 gravel = mix(vOre, uRock, 0.3) * (0.42 + 0.34 * grain) * (0.75 + 0.35 * fine);
  vec3 fill = mix(uRock * 0.3, gravel, lode);
  rock = mix(rock, fill, joint);
  // A few slabs are ore right through.
  rock = mix(rock, gravel * 1.05, lode * step(0.84, cell.z) * (1.0 - joint) * 0.75);
  col = mix(col, rock, rockM);
  diffuseColor.rgb = col;
}`);
  };
  return mat;
}

export function createTerrainMesh(t: Terrain): THREE.Group {
  const group = new THREE.Group();
  const n = t.n;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const kind = new Float32Array(n * n * 2);
  const ore = new Float32Array(n * n * 3);
  const grass = new THREE.Color(PALETTE.ground);
  const cool = new THREE.Color(PALETTE.groundCool);
  const dry = new THREE.Color(PALETTE.groundDry);
  const tmp = new THREE.Color();
  const depCols = t.map.deposits.map((d) => new THREE.Color(ITEM_COLOURS[d.item]));
  const seed = t.map.seed;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = i;
      pos[k * 3 + 1] = t.heights[k];
      pos[k * 3 + 2] = j;
      // A broad drift between cooler and drier grass.
      const v = fbm(i, j, seed + 501, 60, 3);
      tmp.copy(grass);
      if (v < 0) tmp.lerp(cool, Math.min(1, -v * 1.8));
      else tmp.lerp(dry, Math.min(1, v * 1.5));
      col[k * 3] = tmp.r;
      col[k * 3 + 1] = tmp.g;
      col[k * 3 + 2] = tmp.b;
      const g = groundAt(t, i, j);
      kind[k * 2] = g.rock;
      kind[k * 2 + 1] = g.dirt;
      if (g.deposit >= 0) {
        const c = depCols[g.deposit];
        ore[k * 3] = c.r;
        ore[k * 3 + 1] = c.g;
        ore[k * 3 + 2] = c.b;
      }
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
  geo.setAttribute('kind', new THREE.BufferAttribute(kind, 2));
  geo.setAttribute('ore', new THREE.BufferAttribute(ore, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = gritty(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), true);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  group.add(mesh);

  // Skirt: four flat slabs around the map, at the level the edge settles to.
  const skirtMat = gritty(new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 }), false);
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
  return group;
}
