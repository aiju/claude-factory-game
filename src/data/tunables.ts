// Global tunables. Starting values from docs/design.md; changes are logged in docs/notes.md.

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export const SIM = {
  /** RNG seed for the sim's own randomness (not terrain). */
  seed: 0x0f4c_7021,
};

export const BUILD = {
  /** Keep footprints and docks this far inside the map edge, metres. */
  edgeMargin: 2,
};

export const HUB_START = {
  haulers: 6,
  /** Initial hub stock. Empty until construction costs exist (M6). */
  stock: {} as Partial<Record<import('./items').ItemId, number>>,
};

/** Placement snapping (view-side). */
export const SNAP = {
  rotStep: (15 * Math.PI) / 180,
  /** Snap rotation to a neighbour's when within this angle. */
  alignAngle: (12 * Math.PI) / 180,
  /** Neighbours within this gap (metres, edge to edge, roughly) are considered. */
  range: 10,
  /** Snap an edge or centre line when within this distance. */
  dist: 0.8,
};

export const NAV = {
  /** Cells steeper than this (rise over run) are cliffs. */
  maxSlope: 0.6,
  /** Path cost multiplier per unit of slope. */
  slopeCost: 2.5,
  /** Building footprints are inflated by this for navigation, metres. */
  clearance: 0.6,
  /** Smoothed paths keep this far from blocked cells, metres. */
  losClearance: 0.35,
};

export const HAULER = {
  speed: 4,
  capacity: 4,
  accel: 3,
  decel: 5,
  /** rad/s */
  turnRate: 3.2,
  reverseSpeed: 1.1,
  loadTime: 0.6,
  unloadTime: 0.6,
  /** A short pause before pulling out, seconds. */
  pullOut: 0.35,
  /** Slow down on climbs: speed / (1 + k * uphill slope). */
  climbPenalty: 2,
  length: 1.2,
};

export const DISPATCH = {
  /** Ticks between dispatcher passes. */
  interval: 10,
  /** Consumers only ask for a top-up of at least this many, unless starving. */
  minRequest: 4,
  /** Outputs are tidied into the hub once this many are waiting, or when full. */
  tidyMin: 4,
};
