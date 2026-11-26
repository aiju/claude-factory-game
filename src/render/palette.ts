// The palette from docs/visual-style.md. No colour literals elsewhere.

import type { ItemId } from '../data/items';

export const PALETTE = {
  ground: 0xa9b49a,
  groundCool: 0x9aa88c,
  groundDry: 0xc2b99a,
  cliff: 0x6e7480,
  cliffShadow: 0x575c68,
  track: 0xb8a98a,
  road: 0x4a4e57,
  roadMark: 0xe8e4d8,
  skyTop: 0xdce6ea,
  skyHorizon: 0xf3efe6,
  hull: 0xe9e6df,
  hullSecondary: 0xc9ccd1,
  structure: 0x41464e,
  /** Concrete pad under every building. Between ground and hull in brightness. */
  pad: 0xc6c2b8,
  /** Shaded interior seen through an open door. Dark, but never a void. */
  bay: 0x7c8694,
  /** Floor of a tray or bin: dark enough for every item to stand out on. */
  trayFloor: 0x4c4f55,
  /** A hauler's visor panel. */
  glass: 0x14181d,
  /** A hauler's eyes: light on the visor. */
  eye: 0xfff4d6,
  logistics: 0xf28c28,
  power: 0x3cc8c8,
  hazard: 0xf2c230,
  fault: 0xe5484d,
  ok: 0x58c27d,
  /** Warm light from a furnace mouth. Light, not paint, so not an accent. */
  furnaceGlow: 0xffa860,
  /** Sun and fill light colours. */
  sun: 0xfffaf0,
  fillSky: 0xd6e4f0,
  fillGround: 0xa3a596,
} as const;

export type PaletteRole = keyof typeof PALETTE;

export const ITEM_COLOURS: Record<ItemId, number> = {
  ore: 0xb5573a,
  rock: 0xb9b6ae,
  coal: 0x26282c,
  plate: 0x8fa6bf,
  part: 0xd9a441,
  frame: 0xe9e6df,
};

export function css(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
