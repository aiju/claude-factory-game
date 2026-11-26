import * as THREE from 'three';
import { CAMERA } from './data/camera';
import { MAP } from './data/map';
import { Game } from './game';
import { CameraControls } from './input/camera-controls';
import { CameraRig, type CamPose } from './render/camera-rig';
import { createSceneRig } from './render/scene';
import { createTerrainMesh } from './render/terrain-mesh';

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);

const game = new Game();
const rig = createSceneRig(app);
rig.scene.add(createTerrainMesh(game.sim.d.terrain));

const start: CamPose = {
  x: MAP.hub.x + 6,
  z: MAP.hub.z + 10,
  dist: CAMERA.startDist,
  yaw: CAMERA.startYaw,
  pitch: CAMERA.startPitch,
};
const camParam = params.get('cam');
if (camParam) {
  const [x, z, dist, yawDeg, pitchDeg] = camParam.split(',').map(Number);
  Object.assign(start, { x, z, dist, yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 });
}
const camRig = new CameraRig(rig.camera, game.sim.d.terrain, start);
const controls = new CameraControls(rig.renderer.domElement, camRig, { toolWantsRightDrag: () => false });
if (params.has('noedge')) controls.edgeScroll = false;

window.addEventListener('resize', () => rig.resize());

const timer = new THREE.Timer();
timer.connect(document);
function frame(time: number) {
  timer.update(time);
  const dt = timer.getDelta();
  game.advance(dt);
  controls.update(dt);
  camRig.update(dt);
  const d = camRig.cur.dist;
  rig.fog.near = d * 1.1 + 40;
  rig.fog.far = d * 2.2 + 260;
  rig.updateShadow(camRig.target, d);
  rig.renderer.render(rig.scene, rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Hooks for the screenshot script and debugging from the console.
(window as unknown as { __game: unknown }).__game = {
  game,
  camRig,
  rig,
  THREE,
  setCam(p: Partial<CamPose>) {
    Object.assign(camRig.goal, p);
    camRig.snap();
  },
  renderNow() {
    rig.updateShadow(camRig.target, camRig.cur.dist);
    rig.renderer.render(rig.scene, rig.camera);
  },
  ready: true,
};
