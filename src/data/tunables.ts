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
  clearance: 0.8,
  /** Smoothed paths keep this far from blocked cells, metres. */
  losClearance: 0.35,
  /** Extra path cost per metre across the hub's parking rows. */
  parkingCost: 3,
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
  /** The hub takes from a producer when its tray is full, or, for items nothing
   *  consumes, once this many are waiting (so end products go in full loads). */
  tidyMin: 4,
};

/** Trees and boulders: generated from the map seed, solid to haulers, cleared by building. */
export const SCENERY = {
  /** Nothing grows this close to the hub, metres. */
  hubClear: 40,
  /** Nor this far beyond a deposit's edge. */
  depositClear: 7,
  /** Spacing of candidate tree positions, metres. */
  treeGrid: 3.0,
  /** Forest-noise level above which trees grow, and how fast they thicken. */
  forestLevel: 0.06,
  forestDensity: 0.8,
  /** Chance of a lone tree outside forest. */
  loneTree: 0.014,
  /** Fraction of trees that are dead. */
  snags: 0.07,
  maxSlope: 0.3,
  boulderGrid: 9,
  boulderChance: 0.07,
  /** A building clears scenery this far beyond its body, metres. */
  buildMargin: 1.2,
};

/** Wear, tracks and roads (M3). Wear is roughly "hauler passes" per cell. */
export const WEAR = {
  /** Enter / leave thresholds, with hysteresis. */
  trackOn: 10,
  trackOff: 5,
  roadOn: 34,
  roadOff: 20,
  /** Wear stops growing here, so abandoned roads fade in reasonable time. */
  max: 60,
  /** Half-lives in seconds by level: none, track, road (slower once paved). */
  halfLife: [150, 210, 300],
  /** Speed multipliers by level, used by movement and path cost alike. */
  speed: [1, 1.25, 1.6],
  /** Ticks between decay and level updates. */
  interval: 30,
  /** Radius over which a passing bot spreads its wear, metres. */
  spread: 1.3,
};

/** Soft congestion (M3). */
export const CROWD = {
  /** Smoothing time constant of the density field, seconds. */
  tau: 6,
  /** Ticks between density updates. */
  interval: 10,
  /** Density (≈ bots within a cell's 3×3 block) that causes no slowdown. */
  comfortable: 0.7,
  /** Speed is divided by 1 + slow × excess density. */
  slow: 0.5,
  /** Extra path cost per unit of excess density, metres per cell. */
  pathCost: 3,
};

/** Local avoidance between haulers (M3). */
export const AVOID = {
  /** Treat a hauler as a disc of this radius, metres. */
  radius: 0.8,
  /** Look this far ahead, plus some per m/s of speed. */
  look: 2.5,
  lookPerSpeed: 0.7,
  /** Gap to keep behind a bot in front, metres (edge to edge). */
  gap: 0.6,
  /** Strongest steering offset for keeping right / passing, radians. */
  maxSteer: 0.6,
  /** After waiting this long, a bot squeezes past (lower id first), seconds. */
  patience: 4,
  squeeze: 2.5,
};

/** Hauler parking at the hub, sized for the rover (about 1.8 × 1.2 m). */
export const PARKING = {
  /** Bays in the painted row in front of the hub. */
  front: 7,
  spacing: 1.7,
  /** Distance of the bay row's centre line from the hub's front, metres. */
  rowZ: 1.25,
  /** Bays down each side of the hub, and their distance from its side. */
  side: 5,
  sideX: 1.3,
  /** Drive to this far out from the bay, then reverse in. */
  approach: 2.6,
};

/** Hauler eye expressions (view-side; seconds). */
export const FACE = {
  /** Eyes go ^ ^ for this long when a parked hauler is given a job. */
  excitedFor: 1.2,
  /** Parked this long before the eyes close to _ _. */
  dozeAfter: 1.5,
  /** Held up by others this long before > <. */
  frustratedAfter: 1.5,
  /** Once frustrated, stay so at least this long (no flicker). */
  frustratedHold: 1.0,
  /** Neutral eyes blink now and then. */
  blinkEvery: 4.5,
  blinkFor: 0.13,
};
