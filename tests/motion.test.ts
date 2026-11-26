import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/debug/scenarios';
import { HAULER } from '../src/data/tunables';
import { exec } from '../src/sim/commands';
import { angleDiff } from '../src/sim/geom';
import { checkReservations } from '../src/sim/haul';
import { createSim, run } from '../src/sim/world';

describe('hauler motion', () => {
  it('turns like a wheeled vehicle, turning on the spot only now and then', () => {
    const sim = createSim();
    for (const cmd of SCENARIOS.m2()) exec(sim, cmd);
    const prev = new Map<number, { odo: number; heading: number; mode: string }>();
    let moving = 0;
    let pivoting = 0;
    let tooTight = 0;
    let shunts = 0;
    for (let t = 0; t < 30 * 60 * 5; t++) {
      run(sim, 1);
      for (const h of sim.state.haulers) {
        const p = prev.get(h.id);
        if (p && h.mode !== 'idle' && p.mode !== 'idle') {
          // Distance driven (not displacement: other haulers can nudge it).
          const moved = h.odo - p.odo;
          const turned = Math.abs(angleDiff(h.heading, p.heading));
          if (h.man === 'pivot') pivoting++;
          else {
            if (moved > 0) moving++;
            if (turned > moved / HAULER.minTurnRadius + 1e-3) tooTight++;
          }
          if (h.man === 'shunt' && h.manT === 1) shunts++;
        }
        prev.set(h.id, { odo: h.odo, heading: h.heading, mode: h.mode });
      }
    }
    expect(tooTight).toBe(0);
    expect(pivoting / (moving + pivoting)).toBeLessThan(0.03);
    // It does back up to turn round, at docks especially.
    expect(shunts).toBeGreaterThan(10);
    expect(checkReservations(sim)).toEqual([]);
  });
});
