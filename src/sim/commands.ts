// The only way the sim changes from outside. Tools build commands; the sim
// validates and applies them.

import { BUILDINGS, type BuildingTypeId } from '../data/buildings';
import type { ItemId } from '../data/items';
import type { RecipeId } from '../data/recipes';
import { indexAdd, indexRemove, validatePlacement } from './build';
import { addHaulers, cancelJobsFor, repathBlocked } from './haul';
import { clearScenery, navAddBuilding, navRemoveBuilding } from './nav';
import { addLink, planLink, removeLink } from './links';
import { applyRecipe, pruneOutputs } from './prod';
import type { Building } from './types';
import type { Sim } from './world';

export type Command =
  | { type: 'place'; building: BuildingTypeId; x: number; z: number; rot: number; recipe?: RecipeId }
  | { type: 'demolish'; id: number }
  | { type: 'link'; from: number; to: number }
  | { type: 'unlink'; id: number }
  | { type: 'setRecipe'; id: number; recipe: RecipeId }
  | { type: 'debugFill'; id: number }
  | { type: 'debugClearOutputs'; id: number }
  | { type: 'debugAddHaulers'; count: number }
  | { type: 'debugStock'; item: ItemId; n: number };

export type CommandResult = { ok: true; id?: number } | { ok: false; reason: string };

export function newBuilding(sim: Sim, type: BuildingTypeId, x: number, z: number, rot: number, y: number): Building {
  return {
    id: sim.state.nextId++,
    type,
    x,
    z,
    rot,
    y,
    recipe: null,
    extracts: null,
    inp: {},
    out: {},
    store: null,
    progress: 0,
    crafting: false,
    consumed: {},
    status: 'idle',
    missing: null,
    made: 0,
  };
}

export function addBuilding(sim: Sim, b: Building) {
  sim.state.buildings.push(b);
  sim.d.byId.set(b.id, b);
  indexAdd(sim.d.index, b);
  clearScenery(sim, b);
  navAddBuilding(sim, b);
}

export function exec(sim: Sim, cmd: Command): CommandResult {
  switch (cmd.type) {
    case 'place': {
      const def = BUILDINGS[cmd.building];
      if (!def.buildable) return { ok: false, reason: `${def.name} cannot be built.` };
      const v = validatePlacement(sim, cmd.building, cmd.x, cmd.z, cmd.rot);
      if (!v.ok) return v;
      const b = newBuilding(sim, cmd.building, cmd.x, cmd.z, cmd.rot, v.y);
      b.extracts = v.extracts;
      const recipe = cmd.recipe && def.recipes.includes(cmd.recipe) ? cmd.recipe : (def.recipes[0] ?? null);
      applyRecipe(b, recipe);
      addBuilding(sim, b);
      repathBlocked(sim);
      return { ok: true, id: b.id };
    }
    case 'demolish': {
      const b = sim.d.byId.get(cmd.id);
      if (!b) return { ok: false, reason: 'No such building.' };
      if (b.type === 'hub') return { ok: false, reason: 'The hub cannot be demolished.' };
      cancelJobsFor(sim, b.id, false);
      for (const l of sim.state.links.filter((x) => x.from === b.id || x.to === b.id)) removeLink(sim, l, true);
      indexRemove(sim.d.index, b);
      sim.d.byId.delete(b.id);
      sim.state.buildings.splice(sim.state.buildings.indexOf(b), 1);
      navRemoveBuilding(sim, b);
      return { ok: true };
    }
    case 'link': {
      const plan = planLink(sim, cmd.from, cmd.to);
      if (!plan.ok) return plan;
      const l = addLink(sim, cmd.from, cmd.to, plan);
      repathBlocked(sim);
      return { ok: true, id: l.id };
    }
    case 'unlink': {
      const l = sim.state.links.find((x) => x.id === cmd.id);
      if (!l) return { ok: false, reason: 'No such link.' };
      removeLink(sim, l);
      return { ok: true };
    }
    case 'setRecipe': {
      const b = sim.d.byId.get(cmd.id);
      if (!b) return { ok: false, reason: 'No such building.' };
      if (!BUILDINGS[b.type].recipes.includes(cmd.recipe)) return { ok: false, reason: 'Not a recipe for this building.' };
      if (b.recipe === cmd.recipe) return { ok: true };
      cancelJobsFor(sim, b.id, true);
      applyRecipe(b, cmd.recipe);
      return { ok: true };
    }
    case 'debugFill': {
      const b = sim.d.byId.get(cmd.id);
      if (!b) return { ok: false, reason: 'No such building.' };
      for (const s of Object.values(b.inp)) s!.n = Math.max(s!.n, s!.cap - s!.r);
      return { ok: true };
    }
    case 'debugClearOutputs': {
      const b = sim.d.byId.get(cmd.id);
      if (!b) return { ok: false, reason: 'No such building.' };
      for (const s of Object.values(b.out)) s!.n = s!.r;
      pruneOutputs(b);
      return { ok: true };
    }
    case 'debugAddHaulers':
      return addHaulers(sim, cmd.count);
    case 'debugStock': {
      const hub = sim.d.byId.get(sim.state.hub);
      if (!hub?.store) return { ok: false, reason: 'There is no hub.' };
      const s = hub.store[cmd.item]!;
      s.n = Math.max(s.r, s.n + cmd.n);
      return { ok: true };
    }
  }
}
