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
  /** Beyond the clearance, a band this wide costs this much more per metre. */
  bandWidth: 0.8,
  bandCost: 0.6,
  /** Smoothed paths keep this far from blocked cells, metres. */
  losClearance: 0.35,
  /** Trees and boulders are inflated by this for navigation (a hauler's half-width and a little), metres. */
  sceneryClearance: 0.7,
  /** A hauler's centre never comes closer than this to a building's footprint, metres. */
  solidPad: 0.6,
  /** Extra path cost per metre across other buildings' dock aprons. */
  apronCost: 2,
  /** Extra path cost per metre across the hub's parking rows. */
  parkingCost: 3,
};

export const HAULER = {
  speed: 4,
  capacity: 4,
  accel: 3,
  decel: 5,
  /** Tightest turn while moving (radius, metres), like any wheeled vehicle. */
  minTurnRadius: 1.8,
  /** Sideways acceleration allowed in a curve, m/s². */
  lateralAccel: 4.5,
  /** Speed through a bend tighter than the turning circle allows, m/s. */
  tightBendSpeed: 2,
  /** Pure-pursuit lookahead: base metres, plus this per m/s. */
  lookahead: 1.4,
  lookaheadPerSpeed: 0.35,
  /** Backing up to turn: speed, and the longest a shunt lasts (s). */
  shuntSpeed: 1.2,
  shuntMax: 3,
  /** Turning on the spot, only when boxed in, rad/s. */
  pivotRate: 1.4,
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
  trackOn: 8,
  trackOff: 4,
  roadOn: 26,
  roadOff: 15,
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

/** Hauler driving and traffic (M3.5): see "Hauler movement and traffic" in architecture.md. */
export const DRIVE = {
  /** Curvatures tried each tick, across the turning circle. */
  fan: 11,
  /** Half length and half width of a hauler's outline, metres. */
  halfLength: 0.9,
  halfWidth: 0.6,
  /** Margin kept round the outline against buildings, trees, cliffs; and against other haulers. */
  solidMargin: 0.1,
  haulerMargin: 0.15,
  /** A hauler that has right of way is avoided with this much more room, and this many seconds' slack. */
  priorityMargin: 0.35,
  prioritySlack: 0.7,
  /** Held up only by moving traffic: wait this long before backing up, seconds. */
  waitForTraffic: 3,
  /** Look ahead along the path for the point to steer for, metres. */
  pursuit: 3.5,
  /** Arcs are judged by where they get to after this far, metres. */
  judge: 2.5,
  /** Step when sweeping an arc, metres. */
  sweepStep: 0.25,
  /** An arc must be free for at least this far to be driven, metres. */
  minFree: 0.4,
  /** Stopped this long with no way forward, try reversing, seconds. */
  reverseAfter: 0.5,
  /** Once reversing, keep at it at least this long, and at most this long, seconds. */
  minReverse: 0.6,
  maxReverse: 3,
  /** Within 3 m of a dock spot this long without getting there: plan a fresh
   *  approach; this long: stop wherever it is if within nearEnough metres. */
  reapproachAfter: 5,
  nearEnoughAfter: 10,
  nearEnough: 2.2,
  /** Backing onto a dock or bay taking longer than this, drive on forwards instead, seconds. */
  maxReverseLeg: 8,
  /** Score penalty per metre of an arc driven backwards. */
  reverseCost: 1,
  /** Giving way: arcs are also judged at this fraction of the current speed,
   *  and slowing down for someone costs this much in the arc score (metres). */
  yieldSpeed: 0.35,
  yieldCost: 0.4,
  /** Stuck this long, a hauler may clip trees, rocks or cliffs for a short escape, seconds. */
  wedgedAfter: 2,
  /** No headway along the path for this long (a three-point turn going round in circles): turn on the spot, seconds. */
  loopAfter: 6,
  /** Boxed in this long, turn on the spot if there is room, seconds. */
  pivotAfter: 1,
  /** Stopped this long with other haulers about: squeeze past (last resort), seconds. */
  squeezeAfter: 10,
  squeeze: 2,
  /** A hauler standing still this long is an obstacle to route planning, seconds. */
  standAfter: 1,
  /** Radius of the disc a standing hauler stamps on the planning grid, metres. */
  standRadius: 1.6,
  /** Route planning ignores standing haulers this close to its start and goal, metres. */
  standExempt: 2.6,
  /** At most one replan per hauler this often, seconds; and look this far ahead for standing haulers. */
  replanEvery: 1,
  replanLook: 12,
};

/** Hauler parking at the hub, sized for the rover (about 1.8 × 1.2 m). */
export const PARKING = {
  /** Bays in the painted row in front of the hub. */
  front: 7,
  spacing: 2.0,
  /** Distance of the bay row's centre line from the hub's front, metres. */
  rowZ: 1.25,
  /** Bays down each side of the hub, and their distance from its side. */
  side: 5,
  sideX: 1.3,
  /** Parking: stop this far straight out from the bay, turn on the spot to
   *  face away from it, and reverse in. Metres. */
  approach: 2.6,
  /** Every other bay stops this much further out, so neighbours can turn at once. */
  stagger: 1.7,
};

/** Hauler eye expressions (view-side; seconds). */
export const FACE = {
  /** Eyes go ^ ^ for this long when a parked hauler is given a job. */
  excitedFor: 1.2,
  /** Parked this long before the eyes close to _ _. */
  dozeAfter: 1.5,
  /** Making less than `progress` metres of headway for this long gives > <. */
  frustratedAfter: 1.5,
  progress: 0.75,
  /** Once frustrated, stay so at least this long (no flicker). */
  frustratedHold: 0.4,
  /** Neutral eyes blink now and then. */
  blinkEvery: 4.5,
  blinkFor: 0.13,
};

/** Where a hauler's head looks (view-side; seconds, metres, radians). */
export const HEAD = {
  /** Look this far along the path to see a bend coming. */
  lookAhead: 3.5,
  /** Furthest the head turns to look into a bend, or at a building. */
  maxLook: 0.7,
  maxLookAtBuilding: 1.1,
  /** Look at the building once this close to its dock. */
  buildingNear: 4,
  /** Turn round to face backwards when this much reversing is left... */
  reverseDistance: 3,
  /** ...or after reversing this long. */
  reverseTime: 2,
  /** Face forward again after driving forward this long. */
  forwardTime: 0.4,
  /** At least this long between turning round and back. */
  minFlip: 2,
  /** Turning speed, rad/s, and smoothing rate, 1/s. */
  speed: 5,
  smoothing: 7,
};
