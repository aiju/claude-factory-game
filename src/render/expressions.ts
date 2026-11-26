// Which face a hauler shows. Every expression reads something true from the
// sim, so the eyes double as a status readout. Pure logic, no three.js, so it
// can be tested headlessly.

import { FACE, TICK_RATE } from '../data/tunables';
import type { Hauler, HaulerMode } from '../sim/types';

export type Expression = 'neutral' | 'blink' | 'sleepy' | 'excited' | 'frustrated';

export const EXPRESSIONS: Expression[] = ['neutral', 'blink', 'sleepy', 'excited', 'frustrated'];

/** What the view remembers about a hauler between frames. */
export interface FaceMemory {
  mode: HaulerMode;
  /** When it last parked, seconds. */
  idleSince: number;
  excitedUntil: number;
  frustratedUntil: number;
}

export function newFaceMemory(h: Hauler, now: number): FaceMemory {
  return { mode: h.mode, idleSince: h.mode === 'idle' ? now - FACE.dozeAfter : now, excitedUntil: 0, frustratedUntil: 0 };
}

/** `now` is game time in seconds; it must not run while paused. */
export function expressionFor(h: Hauler, mem: FaceMemory, now: number): Expression {
  if (h.mode !== mem.mode) {
    if (mem.mode === 'idle') mem.excitedUntil = now + FACE.excitedFor;
    if (h.mode === 'idle') mem.idleSince = now;
    mem.mode = h.mode;
  }
  // Held up by other haulers, or squeezing past them.
  if (h.wait > FACE.frustratedAfter * TICK_RATE || h.squeeze > 0) mem.frustratedUntil = now + FACE.frustratedHold;
  if (now < mem.frustratedUntil) return 'frustrated';
  if (now < mem.excitedUntil) return 'excited';
  if (h.mode === 'idle' && now - mem.idleSince >= FACE.dozeAfter) return 'sleepy';
  // Each hauler blinks on its own rhythm.
  const period = FACE.blinkEvery * (0.75 + 0.5 * (((h.id * 0.618) % 1 + 1) % 1));
  const phase = (now + h.id * 1.37) % period;
  if (phase < FACE.blinkFor) return 'blink';
  return 'neutral';
}
