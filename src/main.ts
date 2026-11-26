import * as THREE from 'three';
import { CAMERA } from './data/camera';
import { MAP } from './data/map';
import { runScenario } from './debug/scenarios';
import { Game } from './game';
import { createSim } from './sim/world';
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

/** Set by a host page that embeds the game (no query string there). */
const embed = (window as unknown as { __FACTORY__?: { scenario?: string; edgeScroll?: boolean } }).__FACTORY__;

const game = new Game();
const scenario = params.get('scenario') ?? embed?.scenario ?? null;
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
if (params.has('noedge') || embed?.edgeScroll === false) controls.edgeScroll = false;
tools = new Tools(canvas, game, camRig, view, ghost);
const ground = new GroundView(game.sim, rig.scene);
const hud = new Hud(game, tools, ghost, rig.camera, ground);
if (params.has('traffic')) hud.toggleTraffic(true);

/** Start over with a fresh map and a scenario ('' for an empty map). */
function loadScenario(name: string) {
  game.sim = createSim();
  game.log = [];
  if (name) runScenario(game, name);
  view.setSim(game.sim);
  ghost.setSim(game.sim);
  ground.setSim(game.sim);
  tools!.setTool({ kind: 'select' });
  tools!.select(null);
  Object.assign(camRig.goal, start);
}
hud.onScenario = loadScenario;
if (scenario === 'faces') {
  const order = ['neutral', 'sleepy', 'excited', 'frustrated'] as const;
  game.sim.state.haulers.forEach((h, i) => view.haulers.forcedFaces.set(h.id, order[i % 4]));
}
hud.setScenario(scenario ?? '');
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
