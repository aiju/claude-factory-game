import { describe, expect, it } from 'vitest';
import { MAP } from '../src/data/map';
import { createSim, step } from '../src/sim/world';
import { cellSlope, depositAt, heightAt } from '../src/sim/terrain';

describe('M0: world and terrain', () => {
  it('ticks', () => {
    const sim = createSim();
    for (let i = 0; i < 100; i++) step(sim);
    expect(sim.state.tick).toBe(100);
  });

  it('generates the same terrain every time', () => {
    const a = createSim().d.terrain;
    const b = createSim().d.terrain;
    expect(a.heights).toEqual(b.heights);
  });

  it('has flat ground at the hub and every deposit marked', () => {
    const t = createSim().d.terrain;
    const h = MAP.hub;
    const h0 = heightAt(t, h.x, h.z);
    for (const [dx, dz] of [[-8, -6], [8, -6], [-8, 8], [8, 8]]) {
      expect(Math.abs(heightAt(t, h.x + dx, h.z + dz) - h0)).toBeLessThan(0.3);
    }
    MAP.deposits.forEach((d, k) => expect(depositAt(t, d.x, d.z)).toBe(k));
  });

  it('has some cliffs', () => {
    const t = createSim().d.terrain;
    let steep = 0;
    for (let j = 0; j < t.size; j++) for (let i = 0; i < t.size; i++) if (cellSlope(t, i, j) > 1) steep++;
    expect(steep).toBeGreaterThan(200);
  });
});
