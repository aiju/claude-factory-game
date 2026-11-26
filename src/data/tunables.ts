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
