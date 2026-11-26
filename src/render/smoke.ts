// Smoke: soft, camera-facing puffs that rise, spread, drift downwind and
// thin out. Cosmetic only; the sim knows nothing about it.

import * as THREE from 'three';
import { NOISE_GLSL } from './kit';
import { PALETTE } from './palette';

const MAX = 4096;
/** Wind, metres per second. Smoke leans this way as it rises. */
const WIND = new THREE.Vector3(1.1, 0, -0.45);

export interface SmokeKind {
  /** Puff diameter at birth and at the end of its life, metres. */
  from: number;
  to: number;
  life: number;
  /** Initial rise, metres per second. */
  rise: number;
  /** 0 pale, 1 sooty. */
  soot: number;
  opacity: number;
}

export const SMOKE: Record<'stack' | 'exhaust', SmokeKind> = {
  stack: { from: 0.5, to: 3.4, life: 7, rise: 1.9, soot: 1, opacity: 0.5 },
  exhaust: { from: 0.16, to: 0.9, life: 2.4, rise: 1.1, soot: 0.8, opacity: 0.4 },
};

export class SmokeView {
  readonly mesh: THREE.Mesh;
  private n = 0;
  private pos = new Float32Array(MAX * 3);
  private vy = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private seed = new Float32Array(MAX);
  private kinds: SmokeKind[] = [];
  private centre: THREE.InstancedBufferAttribute;
  private info: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private counter = 0;

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.attributes.position);
    this.geo.setAttribute('uv', quad.attributes.uv);
    this.centre = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.info = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.centre.setUsage(THREE.DynamicDrawUsage);
    this.info.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aCentre', this.centre);
    this.geo.setAttribute('aInfo', this.info);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uYoung: { value: new THREE.Color(PALETTE.smokeYoung) },
        uOld: { value: new THREE.Color(PALETTE.smokeOld) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aCentre;
        attribute vec4 aInfo;
        varying vec2 vUv;
        varying vec4 vInfo;
        varying float vTop;
        void main() {
          vUv = uv;
          vInfo = aInfo;
          float rot = aInfo.y * 6.283 + aInfo.x * 1.4 * (aInfo.y - 0.5);
          vec2 c = vec2(position.x * cos(rot) - position.y * sin(rot), position.x * sin(rot) + position.y * cos(rot));
          vTop = c.y + 0.5;
          vec4 mv = viewMatrix * vec4(aCentre.xyz, 1.0);
          mv.xy += c * aCentre.w;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uYoung;
        uniform vec3 uOld;
        varying vec2 vUv;
        varying vec4 vInfo;
        varying float vTop;
        ${NOISE_GLSL}
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float n = kNoise(vec3(vUv * 3.0 + vInfo.y * 37.0, vInfo.x * 1.3));
          float n2 = kNoise(vec3(vUv * 8.0 - vInfo.y * 11.0, vInfo.x * 2.0));
          float body = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.6 + (n2 - 0.5) * 0.25);
          float a = body * vInfo.w;
          if (a < 0.004) discard;
          vec3 col = mix(uOld, uYoung, vInfo.z * (1.0 - smoothstep(0.0, 0.7, vInfo.x)));
          col *= (0.72 + 0.4 * vTop) * (0.85 + 0.3 * n);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  emit(p: THREE.Vector3, kind: SmokeKind) {
    if (this.n >= MAX) return;
    const k = this.n++;
    this.counter++;
    const s = (Math.sin(this.counter * 12.9898) * 43758.5453) % 1;
    const seed = s < 0 ? s + 1 : s;
    this.pos[k * 3] = p.x + (seed - 0.5) * kind.from * 0.5;
    this.pos[k * 3 + 1] = p.y;
    this.pos[k * 3 + 2] = p.z + (((seed * 7.13) % 1) - 0.5) * kind.from * 0.5;
    this.vy[k] = kind.rise * (0.8 + 0.4 * seed);
    this.age[k] = 0;
    this.seed[k] = seed;
    this.kinds[k] = kind;
  }

  update(dt: number) {
    let k = 0;
    while (k < this.n) {
      const kind = this.kinds[k];
      this.age[k] += dt;
      if (this.age[k] >= kind.life) {
        // Swap the last particle into this slot.
        const l = --this.n;
        this.pos.copyWithin(k * 3, l * 3, l * 3 + 3);
        this.vy[k] = this.vy[l];
        this.age[k] = this.age[l];
        this.seed[k] = this.seed[l];
        this.kinds[k] = this.kinds[l];
        continue;
      }
      const a = this.age[k] / kind.life;
      const lean = Math.min(1, this.age[k] * 0.45);
      const wob = Math.sin(this.age[k] * 1.7 + this.seed[k] * 20) * 0.12;
      this.pos[k * 3] += (WIND.x * lean + wob) * dt;
      this.pos[k * 3 + 1] += this.vy[k] * dt;
      this.pos[k * 3 + 2] += (WIND.z * lean + wob * 0.6) * dt;
      this.vy[k] += (0.45 - this.vy[k]) * Math.min(1, dt * 0.5);
      const size = kind.from + (kind.to - kind.from) * (1 - (1 - a) * (1 - a));
      const fade = Math.min(1, a / 0.06) * Math.pow(1 - a, 1.4);
      this.centre.setXYZW(k, this.pos[k * 3], this.pos[k * 3 + 1], this.pos[k * 3 + 2], size);
      this.info.setXYZW(k, a, this.seed[k], kind.soot, fade * kind.opacity);
      k++;
    }
    this.geo.instanceCount = this.n;
    this.centre.needsUpdate = true;
    this.info.needsUpdate = true;
  }

  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
  }
}
