// Global tunables. Starting values from docs/design.md; changes are logged in docs/notes.md.

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export const SIM = {
  /** RNG seed for the sim's own randomness (not terrain). */
  seed: 0x0f4c_7021,
};
