// Saved state types. Plain data only: no classes, no references, no Maps.

import type { BuildingTypeId } from '../data/buildings';
import type { ItemId, RawItemId } from '../data/items';
import type { RecipeId } from '../data/recipes';

export type Status = 'working' | 'idle' | 'starved' | 'blocked' | 'unpowered';

/** A buffer for one item. For inputs `r` is space promised to incoming
 *  deliveries; for outputs and storage it is items promised to pickups. */
export interface Slot {
  n: number;
  r: number;
  cap: number;
  /** Tick the current request opened (inputs), or -1. Used to order requests by age. */
  since: number;
}

export interface Building {
  id: number;
  type: BuildingTypeId;
  x: number;
  z: number;
  rot: number;
  /** Base height of the plinth top, metres. */
  y: number;
  recipe: RecipeId | null;
  /** Extractors: what the deposit beneath yields. */
  extracts: RawItemId | null;
  inp: Partial<Record<ItemId, Slot>>;
  out: Partial<Record<ItemId, Slot>>;
  /** Hub storage. */
  store: Partial<Record<ItemId, Slot>> | null;
  /** Ticks into the current craft; meaningful while crafting. */
  progress: number;
  crafting: boolean;
  /** Inputs consumed by the current craft, refunded if the recipe changes. */
  consumed: Partial<Record<ItemId, number>>;
  status: Status;
  /** For "starved": the first missing ingredient. */
  missing: ItemId | null;
  /** Total crafts completed, for display and tests. */
  made: number;
}

export type HaulerMode =
  | 'idle' // parked at home
  | 'home' // driving home, free for jobs
  | 'pickup' // driving to the source dock
  | 'loading'
  | 'drop' // driving to the destination dock
  | 'unloading';

export interface Hauler {
  id: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  mode: HaulerMode;
  /** Ticks left in loading/unloading. */
  timer: number;
  job: number | null;
  cargo: ItemId | null;
  cargoN: number;
  /** Building id of home (the hub, later depots) and parking bay index. */
  home: number;
  bay: number;
  /** Flat [x0, z0, x1, z1, ...] smoothed waypoints; index of next one. */
  path: number[];
  pathI: number;
  /** Waypoints from this index on are driven in reverse (parking), or -1. */
  revFrom: number;
  /** What it is doing to follow the path: driving it, backing up to turn
   *  (a shunt), or, when boxed in, turning on the spot. */
  man: 'drive' | 'shunt' | 'pivot';
  /** Ticks into the current manoeuvre. */
  manT: number;
  /** Direction of travel: 1 forwards, -1 in reverse. */
  mdir: number;
  /** Ticks to wait before moving (a short pause before pulling out). */
  hold: number;
  /** Total distance driven, metres (stats, tests). */
  odo: number;
  /** Ticks spent stopped while wanting to move. */
  wait: number;
  /** Ticks standing still (for others: standing haulers are planned round). */
  still: number;
  /** Ticks left of squeezing past others, the last resort; and how many times it has. */
  squeeze: number;
  squeezes: number;
  /** Curvature it is driving at (1/m, + is left). */
  curv: number;
  /** Tick of its last replan round a standing hauler. */
  replanAt: number;
  /** Ticks spent close to the end of its path without getting there. */
  nearT: number;
  /** Least remaining path length so far, and the tick it was reached (manoeuvre loops). */
  bestLeft: number;
  bestLeftT: number;
}

export interface Job {
  id: number;
  hauler: number;
  item: ItemId;
  n: number;
  from: number;
  to: number;
  /** True once the cargo is on the hauler. */
  loaded: boolean;
  created: number;
}
