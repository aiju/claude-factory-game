// The palette from docs/visual-style.md. No colour literals elsewhere.

import type { ItemId } from '../data/items';

export const PALETTE = {
  // A cold, scrubby upland: muted grass, bare dirt, grey rock, dark conifers.
  ground: 0x5b654a,
  groundCool: 0x4c5b4d,
  groundDry: 0x7c7650,
  dirt: 0x6a5f50,
  rock: 0x7b7772,
  cliff: 0x5d5a57,
  cliffShadow: 0x454341,
  track: 0x8a7a64,
  road: 0x45464a,
  roadMark: 0xcfc8b6,
  skyTop: 0x9db0c2,
  skyHorizon: 0xcdd1cb,
  /** What the sky lights the scene with from below the horizon. */
  skyGround: 0x4f5446,
  /** Dust that settles on and around everything. */
  dust: 0x7d6f5c,
  bark: 0x4a4038,
  deadwood: 0x756c62,
  foliage: 0x24342d,
  foliageLight: 0x3b4d3c,
  shrub: 0x3f4a34,
  grassBlade: 0x566241,
  grassTip: 0x9a9566,
  smokeYoung: 0x3a3632,
  smokeOld: 0xa9a7a2,

  // Machinery: weathered paint over steel.
  /** Painted panels: a tired off-white. */
  hull: 0xcbc7ba,
  /** Second paint tone: mid grey. */
  hullSecondary: 0x878a8b,
  /** Unpainted plate and fittings. */
  hullDark: 0x5c6064,
  /** Frames, trusses, rubber, mechanisms. */
  structure: 0x34373c,
  /** The gap between panels. */
  seam: 0x26282b,
  /** Metal showing through chipped paint. */
  bareMetal: 0x9da1a4,
  /** Polished rods and rams. */
  chrome: 0xb4b9bd,
  /** Hot, sooty steel. */
  furnace: 0x574d46,
  rust: 0x7a4a2e,
  /** Stained concrete pad under every building. */
  pad: 0x9d9b95,
  padSeam: 0x66645f,
  /** Shaded interior seen through an open door. Dark, but never a void. */
  bay: 0x6e7680,
  /** Floor of a tray or bin: dark enough for every item to stand out on. */
  trayFloor: 0x3c3e42,
  /** A hauler's visor panel. */
  glass: 0x0b0e12,
  /** A hauler's eyes: light on the visor. */
  eye: 0xffedc2,

  // Accents. Functional only.
  logistics: 0xd97a22,
  power: 0x3fd0d8,
  hazard: 0xd9a81f,
  fault: 0xd8433f,
  ok: 0x58c27d,
  /** Warm light from a furnace mouth. Light, not paint, so not an accent. */
  furnaceGlow: 0xff8a3a,
  /** Sun and fill light colours. */
  sun: 0xffe7c4,
  fillSky: 0xb4c6dc,
  fillGround: 0x6a6f5c,
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
