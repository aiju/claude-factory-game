// Item geometries: coloured dots from afar, shapes up close.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ItemId } from '../data/items';
import { hash2 } from '../sim/rng';
import { ITEM_COLOURS, PALETTE } from './palette';

function jitter(g: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = Math.round(x * 1000) * 7 + Math.round(y * 1000) * 13 + Math.round(z * 1000) * 17;
    const f = 1 + (hash2(k, 1, seed) - 0.5) * 2 * amount;
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
  return g;
}

function colourise(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function stripToBasic(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  return out;
}

/** Height of one item when stacked, metres. */
export const ITEM_STACK_HEIGHT: Record<ItemId, number> = {
  ore: 0.26, rock: 0.24, coal: 0.22, plate: 0.08, part: 0.13, frame: 0.3,
};

export function makeItemGeometry(item: ItemId): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (item) {
    case 'ore':
      g = jitter(new THREE.IcosahedronGeometry(0.15, 0), 0.25, 11);
      g.scale(1.05, 0.85, 1.0);
      g.translate(0, 0.12, 0);
      break;
    case 'rock':
      g = jitter(new THREE.DodecahedronGeometry(0.15, 0), 0.3, 23);
      g.scale(1.1, 0.75, 0.9);
      g.translate(0, 0.11, 0);
      break;
    case 'coal':
      g = jitter(new THREE.OctahedronGeometry(0.15, 0), 0.25, 37);
      g.scale(1.0, 0.75, 1.05);
      g.translate(0, 0.11, 0);
      break;
    case 'plate': {
      g = new RoundedBoxGeometry(0.4, 0.07, 0.3, 1, 0.015);
      g.translate(0, 0.035, 0);
      break;
    }
    case 'part': {
      const shape = new THREE.Shape();
      const r = 0.13;
      const notch = 0.35; // half-angle of the notch, radians
      shape.moveTo(Math.cos(notch) * r, Math.sin(notch) * r);
      shape.absarc(0, 0, r, notch, Math.PI * 2 - notch, false);
      shape.lineTo(r * 0.55, -Math.sin(notch) * r * 0.6);
      shape.lineTo(r * 0.55, Math.sin(notch) * r * 0.6);
      shape.closePath();
      g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1, curveSegments: 16 });
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.0, 0);
      break;
    }
    case 'frame': {
      const s = 0.28, t = 0.035;
      const parts: THREE.BufferGeometry[] = [];
      const bar = (w: number, h: number, d: number, x: number, y: number, z: number, col: number) => {
        const b = new THREE.BoxGeometry(w, h, d);
        b.translate(x, y, z);
        parts.push(colourise(stripToBasic(b), col));
      };
      const e = s / 2 - t / 2;
      for (const a of [-e, e]) for (const b of [-e, e]) {
        bar(s - 2 * t, t, t, 0, a + s / 2, b, PALETTE.hull);
        bar(t, t, s - 2 * t, a, b + s / 2, 0, PALETTE.hull);
        bar(t, s - 2 * t, t, a, s / 2, b, PALETTE.hull);
      }
      for (const a of [-e, e]) for (const b of [-e, e]) for (const c of [-e, e]) {
        bar(t * 1.15, t * 1.15, t * 1.15, a, b + s / 2, c, PALETTE.structure);
      }
      return mergeGeometries(parts)!;
    }
  }
  return colourise(stripToBasic(g), ITEM_COLOURS[item]);
}

const materials = new Map<string, THREE.MeshStandardMaterial>();
export function itemMaterial(item: ItemId): THREE.MeshStandardMaterial {
  const metal = item === 'plate' || item === 'part';
  const key = metal ? 'metal' : 'matte';
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: metal ? 0.5 : 0.85,
      metalness: metal ? 0.35 : 0,
    });
    materials.set(key, m);
  }
  return m;
}
