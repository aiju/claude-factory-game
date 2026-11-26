// World state (plain, serialisable data) plus derived caches that are rebuilt
// from it. Everything the sim does goes through step() and commands.

import { BUILDINGS } from '../data/buildings';
import { MAP, type MapDef } from '../data/map';
import { HUB_START, SIM } from '../data/tunables';
import { createIndex, indexAdd, type SpatialIndex } from './build';
import { addBuilding, exec, newBuilding, type Command, type CommandResult } from './commands';
import { addHaulers, tickHaulers } from './haul';
import { createGround, decodeGround, encodeGround, tickGround, type Ground } from './ground';
import { createNav, navAddBuilding, type NavGrid } from './nav';
import { slot, tickBuilding } from './prod';
import { createTerrain, heightAt, type Terrain } from './terrain';
import type { Building, Hauler, Job } from './types';
import { ITEM_IDS } from '../data/items';

export const STATE_VERSION = 3;

export interface WorldState {
  version: number;
  tick: number;
  rng: number;
  nextId: number;
  hub: number;
  /** Sorted by id. */
  buildings: Building[];
  haulers: Hauler[];
  jobs: Job[];
  /** Indices into terrain.scenery that building has removed. */
  cleared: number[];
  /** Wear, roads and crowding. Typed arrays; serialised as base64. */
  ground: Ground;
}

/** Everything that is not saved: rebuilt from state + map. */
export interface Derived {
  terrain: Terrain;
  byId: Map<number, Building>;
  index: SpatialIndex;
  nav: NavGrid;
  /** Bumped whenever a cell changes road level, so the view can refresh. */
  groundVersion: number;
}

export interface Sim {
  state: WorldState;
  d: Derived;
  map: MapDef;
  /** Commands waiting for the next tick. */
  pending: Command[];
  /** Results of commands applied by step(), oldest first; the caller drains it. */
  results: { cmd: Command; res: CommandResult; tick: number }[];
}

function emptyState(map: MapDef): WorldState {
  return { version: STATE_VERSION, tick: 0, rng: SIM.seed, nextId: 1, hub: 0, buildings: [], haulers: [], jobs: [], cleared: [], ground: createGround(map.size) };
}

function buildDerived(sim: Sim) {
  sim.d.byId = new Map();
  sim.d.index = createIndex();
  sim.d.nav = createNav(sim);
  for (const b of sim.state.buildings) {
    sim.d.byId.set(b.id, b);
    indexAdd(sim.d.index, b);
    navAddBuilding(sim, b);
  }
}

/** A new game: the map, the hub, the starting haulers. */
export function createSim(map: MapDef = MAP): Sim {
  const sim = simFromState(emptyState(map), map);
  const h = map.hub;
  const def = BUILDINGS.hub;
  let y = -Infinity;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
    y = Math.max(y, heightAt(sim.d.terrain, h.x + (dx * def.w) / 2, h.z + (dz * def.d) / 2));
  }
  const hub = newBuilding(sim, 'hub', h.x, h.z, h.rot, y);
  hub.store = {};
  for (const item of ITEM_IDS) {
    hub.store[item] = slot(1e9);
    hub.store[item]!.n = HUB_START.stock[item] ?? 0;
  }
  addBuilding(sim, hub);
  sim.state.hub = hub.id;
  addHaulers(sim, HUB_START.haulers);
  return sim;
}

export function simFromState(state: WorldState, map: MapDef = MAP): Sim {
  const terrain = createTerrain(map);
  const sim: Sim = {
    state,
    d: { terrain, byId: new Map(), index: createIndex(), nav: { size: 0 } as NavGrid, groundVersion: 0 },
    map,
    pending: [],
    results: [],
  };
  buildDerived(sim);
  return sim;
}

/** Queue a command for the next tick. */
export function submit(sim: Sim, cmd: Command) {
  sim.pending.push(cmd);
}

export function step(sim: Sim): void {
  if (sim.pending.length) {
    const cmds = sim.pending;
    sim.pending = [];
    for (const cmd of cmds) sim.results.push({ cmd, res: exec(sim, cmd), tick: sim.state.tick });
    if (sim.results.length > 100) sim.results.splice(0, sim.results.length - 100);
  }
  for (const b of sim.state.buildings) tickBuilding(b);
  tickHaulers(sim);
  tickGround(sim);
  sim.state.tick++;
}

export function run(sim: Sim, ticks: number) {
  for (let i = 0; i < ticks; i++) step(sim);
}

export function serialise(sim: Sim): string {
  return JSON.stringify({ ...sim.state, ground: encodeGround(sim.state.ground) });
}

export function deserialise(json: string, map: MapDef = MAP): Sim {
  const raw = JSON.parse(json);
  if (raw.version !== STATE_VERSION) throw new Error(`Unsupported save version ${raw.version}`);
  const state = { ...raw, ground: decodeGround(raw.ground) } as WorldState;
  return simFromState(state, map);
}

export function hubOf(sim: Sim): Building {
  return sim.d.byId.get(sim.state.hub)!;
}
