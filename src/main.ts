import * as THREE from 'three';
import { CAMERA } from './data/camera';
import { MAP } from './data/map';
import { runScenario } from './debug/scenarios';
import { Game } from './game';
import { CameraControls } from './input/camera-controls';
import { Tools } from './input/tools';
import { CameraRig, type CamPose } from './render/camera-rig';
import { GhostView } from './render/ghost';
import { GroundView } from './render/ground-view';
import { createSceneRig } from './render/scene';
import { createTerrainMesh } from './render/terrain-mesh';
import { WorldView } from './render/world-view';
import { Hud } from './ui/hud';

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);

const game = new Game();
const scenario = params.get('scenario');
if (scenario) runScenario(game, scenario);

const rig = createSceneRig(app);
rig.scene.add(createTerrainMesh(game.sim.d.terrain));
const view = new WorldView(game.sim);
rig.scene.add(view.group);
game.beforeTick = () => view.haulers.snapshot();
const ghost = new GhostView(game.sim);
rig.scene.add(ghost.group);

const start: CamPose = {
  x: MAP.hub.x + 6,
  z: MAP.hub.z + 2,
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
const canvas = rig.renderer.domElement;
let tools: Tools | null = null;
const controls = new CameraControls(canvas, camRig, { toolWantsRightDrag: () => tools?.wantsRightDrag() ?? false });
if (params.has('noedge')) controls.edgeScroll = false;
tools = new Tools(canvas, game, camRig, view, ghost);
const ground = new GroundView(game.sim, rig.scene);
const hud = new Hud(game, tools, ghost, rig.camera, ground);
if (params.has('traffic')) hud.toggleTraffic(true);
if (params.has('paused')) hud.setSpeed(0);

window.addEventListener('resize', () => rig.resize());

let alpha = 1;
function render(dt: number, gameDt: number) {
  const d = camRig.cur.dist;
  rig.fog.near = d * 1.1 + 40;
  rig.fog.far = d * 2.2 + 260;
  view.update(alpha, gameDt);
  ground.update(dt);
  rig.updateShadow(camRig.target, d);
  rig.renderer.render(rig.scene, rig.camera);
  hud.update(dt);
}

const timer = new THREE.Timer();
timer.connect(document);
function frame(time: number) {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1);
  alpha = game.advance(dt);
  controls.update(dt);
  camRig.update(dt);
  render(dt, dt * game.speed);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Hooks for the screenshot script and for debugging from the console.
(window as unknown as { __game: unknown }).__game = {
  game,
  camRig,
  rig,
  view,
  tools,
  hud,
  ground,
  THREE,
  setCam(p: Partial<CamPose>) {
    Object.assign(camRig.goal, p);
    camRig.snap();
  },
  /** Render a frame as if `seconds` of game time had passed (animations, smoke). */
  renderNow(seconds = 0) {
    const steps = Math.ceil(seconds * 30);
    for (let i = 0; i < steps; i++) view.update(1, 1 / 30);
    ground.update(Infinity);
    render(0, 0);
  },
  ready: true,
};
