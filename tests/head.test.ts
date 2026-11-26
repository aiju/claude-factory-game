import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/debug/scenarios';
import { TICK_RATE } from '../src/data/tunables';
import { newHeadMemory, updateHead, type HeadMemory } from '../src/render/head';
import { exec } from '../src/sim/commands';
import { createSim, run, type Sim } from '../src/sim/world';
import { must } from './helpers';

function watchHeads(sim: Sim, ticks: number, each: (id: number, mem: HeadMemory, mode: string, now: number) => void) {
  const mem = new Map<number, HeadMemory>();
  for (let k = 0; k < ticks; k++) {
    run(sim, 1);
    const now = sim.state.tick / TICK_RATE;
    for (const h of sim.state.haulers) {
      let m = mem.get(h.id);
      if (!m) mem.set(h.id, (m = newHeadMemory()));
      updateHead(sim, h, m, now, 1 / TICK_RATE);
      each(h.id, m, h.mode, now);
    }
  }
}

describe('hauler heads', () => {
  it('look over the shoulder when reversing into a bay, and forward again once parked', () => {
    const sim = createSim();
    sim.state.haulers.length = 1;
    must(sim, { type: 'place', building: 'smelter', x: 140, z: 150, rot: 0 });
    exec(sim, { type: 'debugStock', item: 'ore', n: 4 });
    let lookedBack = false;
    let lastYaw = 0;
    let lastMode = '';
    watchHeads(sim, 60 * TICK_RATE, (_id, m, mode) => {
      if (mode === 'home' && Math.abs(m.yaw) > 2.8) lookedBack = true;
      lastYaw = m.yaw;
      lastMode = mode;
    });
    expect(lookedBack).toBe(true);
    expect(lastMode).toBe('idle');
    expect(Math.abs(lastYaw)).toBeLessThan(0.05);
  });

  it('turn round only now and then on a busy chain', () => {
    const sim = createSim();
    for (const cmd of SCENARIOS.m2()) exec(sim, cmd);
    const flips = new Map<number, number>();
    const was = new Map<number, boolean>();
    let lookingAround = 0;
    let samples = 0;
    watchHeads(sim, 5 * 60 * TICK_RATE, (id, m) => {
      if (was.has(id) && was.get(id) !== m.back) flips.set(id, (flips.get(id) ?? 0) + 1);
      was.set(id, m.back);
      samples++;
      if (Math.abs(m.yaw) > 0.1) lookingAround++;
    });
    const perHaulerPerMinute = [...flips.values()].reduce((a, b) => a + b, 0) / sim.state.haulers.length / 5;
    expect(perHaulerPerMinute).toBeLessThan(6);
    // And they do look about while working.
    expect(lookingAround / samples).toBeGreaterThan(0.1);
  });
});
