import * as THREE from 'three';
import { heightAt, type Terrain } from '../sim/terrain';

const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();

export function screenRay(camera: THREE.Camera, el: HTMLElement, clientX: number, clientY: number): THREE.Ray {
  const r = el.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.clone();
}

/** March the heightfield along a ray. Returns the ground point, or null. */
export function pickGround(t: Terrain, r: THREE.Ray, maxDist = 2500): THREE.Vector3 | null {
  const p = new THREE.Vector3();
  let prev = 0;
  let step = 0.5;
  for (let d = 0; d < maxDist; d += step) {
    r.at(d, p);
    const inside = p.x >= 0 && p.z >= 0 && p.x <= t.size && p.z <= t.size;
    const h = inside ? heightAt(t, p.x, p.z) : t.map.baseHeight - 0.08;
    if (p.y <= h) {
      // Bisect between prev and d.
      let a = prev, b = d;
      for (let i = 0; i < 12; i++) {
        const m = (a + b) / 2;
        r.at(m, p);
        const hm = heightAt(t, p.x, p.z);
        if (p.y <= hm) b = m;
        else a = m;
      }
      r.at(b, p);
      return p;
    }
    prev = d;
    // Take bigger steps while far above the terrain.
    step = Math.max(0.5, Math.min(8, (p.y - h) * 0.5));
  }
  return null;
}

/** Intersect a ray with the horizontal plane y = h. */
export function pickPlane(r: THREE.Ray, h: number): THREE.Vector3 | null {
  if (Math.abs(r.direction.y) < 1e-6) return null;
  const d = (h - r.origin.y) / r.direction.y;
  if (d < 0) return null;
  return r.at(d, new THREE.Vector3());
}
