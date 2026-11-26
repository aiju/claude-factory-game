// Owns the sim and the fixed-tick clock. Game speed runs more ticks per frame.

import { DT } from './data/tunables';
import { createSim, step, type Sim } from './sim/world';

export type Speed = 0 | 1 | 2 | 4;

export class Game {
  sim: Sim;
  speed: Speed = 1;
  private acc = 0;
  /** Called before each tick, so the view can keep the previous state for interpolation. */
  beforeTick: (() => void) | null = null;

  constructor(sim?: Sim) {
    this.sim = sim ?? createSim();
  }

  /** Advance by real time. Returns the interpolation fraction into the next tick. */
  advance(realDt: number): number {
    if (this.speed === 0) return 1;
    this.acc += Math.min(realDt, 0.1) * this.speed;
    // Never fall into a spiral: cap the work per frame.
    const maxTicks = 8 * this.speed;
    let n = 0;
    while (this.acc >= DT && n < maxTicks) {
      this.tick();
      this.acc -= DT;
      n++;
    }
    if (n === maxTicks) this.acc = 0;
    return Math.min(1, this.acc / DT);
  }

  tick() {
    this.beforeTick?.();
    step(this.sim);
  }

  /** Run ticks as fast as possible (debug, screenshots). */
  warp(ticks: number) {
    for (let i = 0; i < ticks; i++) this.tick();
  }
}
