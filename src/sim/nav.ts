// Navigation grid (M2).
import type { Building } from './types';
import type { Sim } from './world';

export interface NavGrid {
  size: number;
}
export function createNav(sim: Sim): NavGrid {
  return { size: sim.d.terrain.size };
}
export function navAddBuilding(_sim: Sim, _b: Building) {}
export function navRemoveBuilding(_sim: Sim, _b: Building) {}
