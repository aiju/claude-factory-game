import type { ItemId } from './items';

export type RecipeId = 'extract' | 'smelt' | 'part' | 'frame' | 'burn';

export interface RecipeDef {
  id: RecipeId;
  name: string;
  inputs: Partial<Record<ItemId, number>>;
  outputs: Partial<Record<ItemId, number>>;
  /** Seconds per craft. */
  time: number;
  /** Extractors: produce this many of the deposit's item per craft. */
  extract?: number;
  /** Generators: power supplied while burning (M5). */
  power?: number;
}

export const RECIPES: Record<RecipeId, RecipeDef> = {
  extract: { id: 'extract', name: 'Extract', inputs: {}, outputs: {}, time: 2, extract: 1 },
  smelt: { id: 'smelt', name: 'Plate', inputs: { ore: 2 }, outputs: { plate: 1 }, time: 4 },
  part: { id: 'part', name: 'Part', inputs: { plate: 2 }, outputs: { part: 1 }, time: 6 },
  frame: { id: 'frame', name: 'Frame', inputs: { plate: 1, rock: 2 }, outputs: { frame: 1 }, time: 6 },
  burn: { id: 'burn', name: 'Burn coal', inputs: { coal: 1 }, outputs: {}, time: 10, power: 20 },
};
