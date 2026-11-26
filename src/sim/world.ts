// World state (plain, serialisable data) plus derived caches that are rebuilt
// from it. Everything the sim does goes through step() and commands.

import { MAP, type MapDef } from '../data/map';
import { SIM } from '../data/tunables';
import { createTerrain, type Terrain } from './terrain';

export const STATE_VERSION = 1;

export interface WorldState {
  version: number;
  tick: number;
  rng: number;
  nextId: number;
}

/** Everything that is not saved: rebuilt from state + map. */
export interface Derived {
  terrain: Terrain;
}

export interface Sim {
  state: WorldState;
  d: Derived;
  map: MapDef;
}

export function createState(): WorldState {
  return { version: STATE_VERSION, tick: 0, rng: SIM.seed, nextId: 1 };
}

export function createSim(map: MapDef = MAP, state?: WorldState): Sim {
  const terrain = createTerrain(map);
  return { state: state ?? createState(), d: { terrain }, map };
}

export function step(sim: Sim): void {
  sim.state.tick++;
}

export function serialise(sim: Sim): string {
  return JSON.stringify(sim.state);
}

export function deserialise(json: string, map: MapDef = MAP): Sim {
  const state = JSON.parse(json) as WorldState;
  if (state.version !== STATE_VERSION) throw new Error(`Unsupported save version ${state.version}`);
  return createSim(map, state);
}
