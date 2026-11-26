// Recipes running against buffers, and building status.

import { BUILDINGS } from '../data/buildings';
import type { ItemId } from '../data/items';
import { RECIPES, type RecipeDef, type RecipeId } from '../data/recipes';
import { TICK_RATE } from '../data/tunables';
import type { Building, Slot } from './types';

export function slot(cap: number): Slot {
  return { n: 0, r: 0, cap, since: -1 };
}

export function recipeInputs(r: RecipeDef): [ItemId, number][] {
  return Object.entries(r.inputs) as [ItemId, number][];
}

export function recipeOutputs(r: RecipeDef, b: Building): [ItemId, number][] {
  if (r.extract && b.extracts) return [[b.extracts, r.extract]];
  return Object.entries(r.outputs) as [ItemId, number][];
}

export function craftTicks(r: RecipeDef): number {
  return Math.round(r.time * TICK_RATE);
}

/** Set up buffers for the building's current recipe. Leftover items stay on
 *  offer in the output buffer (cap 0) until something collects them. */
export function applyRecipe(b: Building, recipe: RecipeId | null) {
  const def = BUILDINGS[b.type];
  // Refund a craft in progress.
  if (b.crafting) {
    for (const [item, n] of Object.entries(b.consumed) as [ItemId, number][]) addLeftover(b, item, n);
    b.crafting = false;
    b.progress = 0;
    b.consumed = {};
  }
  b.recipe = recipe;
  const r = recipe ? RECIPES[recipe] : null;
  const keepIn: Partial<Record<ItemId, Slot>> = {};
  if (r) {
    for (const [item, n] of recipeInputs(r)) {
      const old = b.inp[item];
      const cap = n * def.inputCrafts;
      keepIn[item] = old ? { ...old, cap } : slot(cap);
    }
  }
  for (const [item, s] of Object.entries(b.inp) as [ItemId, Slot][]) {
    if (keepIn[item]) continue;
    // Callers cancel inbound jobs before changing recipe, so r is 0 here.
    if (s.n > 0) addLeftover(b, item, s.n);
  }
  b.inp = keepIn;
  const products = r ? recipeOutputs(r, b) : [];
  for (const [item, s] of Object.entries(b.out) as [ItemId, Slot][]) {
    if (!products.some(([p]) => p === item)) s.cap = 0;
  }
  for (const [item] of products) {
    const s = b.out[item];
    if (s) s.cap = def.outputCap;
    else b.out[item] = slot(def.outputCap);
  }
  pruneOutputs(b);
}

function addLeftover(b: Building, item: ItemId, n: number) {
  const s = b.out[item] ?? (b.out[item] = slot(0));
  s.n += n;
}

/** Drop empty, unreserved output slots that are no longer produced. */
export function pruneOutputs(b: Building) {
  for (const [item, s] of Object.entries(b.out) as [ItemId, Slot][]) {
    if (s.cap === 0 && s.n === 0 && s.r === 0) delete b.out[item];
  }
}

export function tickBuilding(b: Building, rate = 1) {
  if (b.type === 'hub' || !b.recipe) {
    b.status = 'idle';
    return;
  }
  const r = RECIPES[b.recipe];
  if (b.crafting) {
    b.progress += rate;
    if (b.progress >= craftTicks(r)) {
      for (const [item, n] of recipeOutputs(r, b)) b.out[item]!.n += n;
      b.crafting = false;
      b.progress = 0;
      b.consumed = {};
      b.made++;
    }
  }
  if (!b.crafting) {
    let blocked = false;
    for (const [item, n] of recipeOutputs(r, b)) {
      const s = b.out[item]!;
      if (s.n + n > s.cap) blocked = true;
    }
    let missing: ItemId | null = null;
    for (const [item, n] of recipeInputs(r)) {
      if ((b.inp[item]?.n ?? 0) < n) {
        missing = item;
        break;
      }
    }
    if (blocked) {
      b.status = 'blocked';
      b.missing = null;
    } else if (missing) {
      b.status = 'starved';
      b.missing = missing;
    } else {
      for (const [item, n] of recipeInputs(r)) {
        b.inp[item]!.n -= n;
        b.consumed[item] = n;
      }
      b.crafting = true;
      b.progress = 0;
    }
  }
  if (b.crafting) {
    b.status = 'working';
    b.missing = null;
  }
}
