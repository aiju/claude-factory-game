// The one fixed map. Everything here is hand-placed or seeded; the terrain is
// generated from these numbers deterministically (see sim/terrain.ts).

import type { RawItemId } from './items';

export interface PlateauDef {
  x: number;
  z: number;
  /** Ellipse radii in metres. */
  rx: number;
  rz: number;
  /** Ellipse rotation, radians. */
  rot: number;
  /** Rise above the surrounding ground, metres. */
  height: number;
  /** Horizontal width of the cliff edge, metres. Small means steep. */
  cliff: number;
  /** A gentle ramp up onto the plateau, so it can be reached. */
  ramp: { angle: number; arc: number; width: number };
}

export interface DepositDef {
  item: RawItemId;
  x: number;
  z: number;
  r: number;
}

export interface MapDef {
  size: number;
  seed: number;
  baseHeight: number;
  noise: { scale: number; amp: number }[];
  /** Areas blended to flat ground (radius, then falloff). */
  flats: { x: number; z: number; r: number; falloff: number }[];
  plateaus: PlateauDef[];
  deposits: DepositDef[];
  hub: { x: number; z: number; rot: number };
}

export const MAP: MapDef = {
  size: 256,
  seed: 0x5eed_2604,
  baseHeight: 4,
  noise: [
    { scale: 90, amp: 3.2 },
    { scale: 28, amp: 0.7 },
  ],
  flats: [{ x: 128, z: 128, r: 22, falloff: 18 }],
  plateaus: [
    {
      x: 196, z: 66, rx: 34, rz: 24, rot: 0.4, height: 7, cliff: 4,
      ramp: { angle: Math.PI * 0.85, arc: 0.55, width: 30 },
    },
    {
      x: 54, z: 206, rx: 28, rz: 22, rot: -0.3, height: 6, cliff: 3.6,
      ramp: { angle: -Math.PI * 0.15, arc: 0.5, width: 28 },
    },
    {
      x: 70, z: 60, rx: 16, rz: 34, rot: 0.9, height: 4.5, cliff: 3,
      ramp: { angle: Math.PI * 0.35, arc: 0.6, width: 22 },
    },
  ],
  deposits: [
    // Ore: one close to the hub, one further out.
    { item: 'ore', x: 152, z: 104, r: 7 },
    { item: 'ore', x: 96, z: 168, r: 6 },
    { item: 'ore', x: 214, z: 176, r: 8 },
    // Rock: the other side.
    { item: 'rock', x: 168, z: 160, r: 7 },
    { item: 'rock', x: 66, z: 112, r: 6 },
    // Coal: up on the plateaus, further away.
    { item: 'coal', x: 200, z: 62, r: 7 },
    { item: 'coal', x: 50, z: 210, r: 6 },
    { item: 'coal', x: 128, z: 36, r: 5 },
  ],
  hub: { x: 128, z: 126, rot: 0 },
};
