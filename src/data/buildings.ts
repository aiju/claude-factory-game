import type { RecipeId } from './recipes';

export type BuildingTypeId = 'hub' | 'extractor' | 'smelter' | 'fabricator' | 'generator' | 'pylon';

export interface BuildingDef {
  id: BuildingTypeId;
  name: string;
  /** Body footprint in local X (width) and Z (depth), metres. */
  w: number;
  d: number;
  /** Dock apron in front of the body (local +Z), or null for none. */
  dock: { w: number; d: number } | null;
  recipes: RecipeId[];
  /** Input buffer capacity, in crafts' worth of each ingredient. */
  inputCrafts: number;
  /** Output buffer capacity per product, items. */
  outputCap: number;
  /** Max height difference across the footprint, metres. */
  maxUnevenness: number;
  needsDeposit: boolean;
  /** Shown in the build bar. False for the hub and for things not built yet. */
  buildable: boolean;
  hotkey?: string;
  blurb: string;
}

export const BUILDINGS: Record<BuildingTypeId, BuildingDef> = {
  hub: {
    id: 'hub', name: 'Hub', w: 14, d: 9, dock: { w: 12, d: 7 },
    recipes: [], inputCrafts: 0, outputCap: 0, maxUnevenness: 1.5,
    needsDeposit: false, buildable: false,
    blurb: 'Stores everything and houses the haulers.',
  },
  extractor: {
    id: 'extractor', name: 'Extractor', w: 4, d: 4, dock: { w: 3.2, d: 2.6 },
    recipes: ['extract'], inputCrafts: 0, outputCap: 8, maxUnevenness: 1.2,
    needsDeposit: true, buildable: true, hotkey: '1',
    blurb: 'Takes raw items from the deposit beneath it.',
  },
  smelter: {
    id: 'smelter', name: 'Smelter', w: 5, d: 5, dock: { w: 3.6, d: 2.6 },
    recipes: ['smelt'], inputCrafts: 4, outputCap: 6, maxUnevenness: 1.2,
    needsDeposit: false, buildable: true, hotkey: '2',
    blurb: 'Smelts ore into plate.',
  },
  fabricator: {
    id: 'fabricator', name: 'Fabricator', w: 8, d: 5, dock: { w: 4.4, d: 2.6 },
    recipes: ['part', 'frame'], inputCrafts: 4, outputCap: 6, maxUnevenness: 1.2,
    needsDeposit: false, buildable: true, hotkey: '3',
    blurb: 'Makes parts or frames from plate.',
  },
  generator: {
    id: 'generator', name: 'Generator', w: 5, d: 5, dock: { w: 3.6, d: 2.6 },
    recipes: ['burn'], inputCrafts: 4, outputCap: 0, maxUnevenness: 1.2,
    needsDeposit: false, buildable: false,
    blurb: 'Burns coal for power.',
  },
  pylon: {
    id: 'pylon', name: 'Pylon', w: 0.8, d: 0.8, dock: null,
    recipes: [], inputCrafts: 0, outputCap: 0, maxUnevenness: 3,
    needsDeposit: false, buildable: false,
    blurb: 'Extends the power network.',
  },
};

export const BUILD_BAR: BuildingTypeId[] = (Object.keys(BUILDINGS) as BuildingTypeId[]).filter(
  (k) => BUILDINGS[k].buildable,
);
