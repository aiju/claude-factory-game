import { describe, expect, it } from 'vitest';
import { gapScenario } from '../src/debug/scenarios';
import { TICK_RATE } from '../src/data/tunables';
import { expressionFor, newFaceMemory, type Expression, type FaceMemory } from '../src/render/expressions';
import { exec } from '../src/sim/commands';
import { createSim, run, type Sim } from '../src/sim/world';
import { must } from './helpers';

/** Run the sim, reading every hauler's face each tick as the view would. */
function watch(sim: Sim, ticks: number, onFace: (id: number, ex: Expression, t: number) => void, mem = new Map<number, FaceMemory>()) {
  for (let k = 0; k < ticks; k++) {
    run(sim, 1);
    const now = sim.state.tick / TICK_RATE;
    for (const h of sim.state.haulers) {
      let m = mem.get(h.id);
      if (!m) mem.set(h.id, (m = newFaceMemory(h, now)));
      onFace(h.id, expressionFor(h, m, now), now);
    }
  }
}

describe('hauler faces', () => {
  it('parked haulers doze; a new job makes them light up, then drive neutral', () => {
    const sim = createSim();
    const seen = new Map<number, Expression[]>();
    const mem = new Map<number, FaceMemory>();
    watch(sim, 3 * TICK_RATE, (id, ex) => (seen.get(id) ?? seen.set(id, []).get(id)!).push(ex), mem);
    // Parked from the start: asleep.
    for (const list of seen.values()) expect(list.at(-1)).toBe('sleepy');
    // Give one of them something to fetch.
    must(sim, { type: 'place', building: 'smelter', x: 140, z: 150, rot: 0 });
    exec(sim, { type: 'debugStock', item: 'ore', n: 8 });
    const after = new Map<number, Expression[]>();
    watch(sim, 6 * TICK_RATE, (id, ex) => (after.get(id) ?? after.set(id, []).get(id)!).push(ex), mem);
    const woke = [...after.entries()].find(([, l]) => l.includes('excited'))!;
    expect(woke).toBeDefined();
    const list = [...seen.get(woke[0])!, ...woke[1]];
    const first = list.indexOf('excited');
    // Excited comes straight out of sleep, then gives way to driving.
    expect(list[first - 1]).toBe('sleepy');
    expect(list.slice(first).includes('neutral')).toBe(true);
  });

  it('haulers stuck in a jam look frustrated, and not for ever', () => {
    const sim = createSim();
    for (const cmd of gapScenario(136, 3, 24)) exec(sim, cmd);
    const frustrated = new Map<number, number>();
    let ticks = 0;
    watch(sim, 4 * 60 * TICK_RATE, (id, ex) => {
      if (ex === 'frustrated') frustrated.set(id, (frustrated.get(id) ?? 0) + 1);
      ticks++;
    });
    expect(frustrated.size).toBeGreaterThan(3);
    // A jam, not a permanent state: well under half of all hauler-time.
    const total = [...frustrated.values()].reduce((a, b) => a + b, 0);
    expect(total / ticks).toBeLessThan(0.4);
  });

  it('neutral eyes blink briefly now and then', () => {
    const sim = createSim();
    sim.state.haulers.length = 1;
    const h = sim.state.haulers[0];
    Object.assign(h, { mode: 'home', path: [200, 200], pathI: 0 });
    const mem = newFaceMemory(h, 0);
    let blinks = 0;
    let open = 0;
    for (let t = 0; t < 20; t += 1 / 30) {
      const ex = expressionFor(h, mem, t);
      if (ex === 'blink') blinks++;
      if (ex === 'neutral') open++;
    }
    expect(blinks).toBeGreaterThan(5);
    expect(blinks / (blinks + open)).toBeLessThan(0.1);
  });
});
