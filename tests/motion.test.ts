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

describe('hauler collisions', () => {
  it('never drive into buildings, and only touch each other when squeezing out of a deadlock', async () => {
    const { buildingBody } = await import('../src/sim/build');
    const { inflate, obbOverlap } = await import('../src/sim/geom');
    const { gapScenario } = await import('../src/debug/scenarios');
    for (const cmds of [SCENARIOS.m2(), gapScenario(136, 3, 24)]) {
      const sim = createSim();
      for (const cmd of cmds) exec(sim, cmd);
      let inside = 0;
      let touching = 0;
      let samples = 0;
      for (let t = 0; t < 30 * 60 * 4; t++) {
        run(sim, 1);
        const hs = sim.state.haulers;
        for (const h of hs) {
          samples++;
          for (const b of sim.state.buildings) {
            const o = inflate(buildingBody(b), 0.3);
            const [lx, lz] = [(h.x - o.cx) * Math.cos(o.rot) - (h.z - o.cz) * Math.sin(o.rot), (h.x - o.cx) * Math.sin(o.rot) + (h.z - o.cz) * Math.cos(o.rot)];
            if (Math.abs(lx) < o.hx && Math.abs(lz) < o.hz) inside++;
          }
        }
        for (let i = 0; i < hs.length; i++) {
          for (let j = i + 1; j < hs.length; j++) {
            const a = hs[i];
            const c = hs[j];
            if (Math.hypot(a.x - c.x, a.z - c.z) > 2.5 || a.squeeze > 0 || c.squeeze > 0) continue;
            // Shrunk a little: grazing corners don't count.
            const A = { cx: a.x, cz: a.z, hx: 0.5, hz: 0.8, rot: a.heading };
            const C = { cx: c.x, cz: c.z, hx: 0.5, hz: 0.8, rot: c.heading };
            if (obbOverlap(A, C, 0)) touching++;
          }
        }
      }
      expect(inside).toBe(0);
      expect(touching / samples).toBeLessThan(0.002);
    }
  });
});
