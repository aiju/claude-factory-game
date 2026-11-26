// Renderer, lights, sky and fog.

import * as THREE from 'three';
import { PALETTE } from './palette';

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  fog: THREE.Fog;
  /** Keep the shadow frustum around what the camera is looking at. */
  updateShadow(target: THREE.Vector3, viewDist: number): void;
  resize(): void;
}

// A lowish, warm sun from the front-left of an unrotated building, so dock
// sides are lit in the default view; shadows are long enough to model form.
const SUN_ELEVATION = (40 * Math.PI) / 180;
const SUN_INTENSITY = 3.9;
const HEMI_INTENSITY = 0.5;
const ENV_INTENSITY = 1.05;
const SUN_AZIMUTH = (-58 * Math.PI) / 180;

function makeSky(radius: number, ground: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      ground: { value: new THREE.Color(ground) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 ground;
      varying vec3 vDir;
      void main() {
        float y = normalize(vDir).y;
        vec3 c = mix(horizon, top, smoothstep(0.0, 0.45, y));
        c = mix(ground, c, smoothstep(-0.2, 0.0, y));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

export function createSceneRig(container: HTMLElement): SceneRig {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyHorizon);
  const fog = new THREE.Fog(PALETTE.skyHorizon, 140, 620);
  scene.fog = fog;
  const sky = makeSky(2000, PALETTE.skyHorizon);
  scene.add(sky);
  // The same sky, with a dark ground, lights the scene and shows in bare metal.
  const envScene = new THREE.Scene();
  envScene.add(makeSky(50, PALETTE.skyGround));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  scene.environmentIntensity = ENV_INTENSITY;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);

  const hemi = new THREE.HemisphereLight(PALETTE.fillSky, PALETTE.fillGround, HEMI_INTENSITY);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(PALETTE.sun, SUN_INTENSITY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);

  const sunDir = new THREE.Vector3(
    Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
    Math.sin(SUN_ELEVATION),
    Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
  );

  function updateShadow(target: THREE.Vector3, viewDist: number) {
    const ext = Math.min(220, Math.max(30, viewDist * 0.75));
    const cam = sun.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 1;
    cam.far = 600;
    cam.updateProjectionMatrix();
    // Snap to shadow texels to keep edges from crawling while panning.
    const texel = (2 * ext) / sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    sun.target.position.set(tx, target.y, tz);
    sun.position.set(tx + sunDir.x * 300, target.y + sunDir.y * 300, tz + sunDir.z * 300);
    sky.position.copy(camera.position);
  }

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  return { renderer, scene, camera, sun, fog, updateShadow, resize };
}
