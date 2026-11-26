import { describe, expect, it } from 'vitest';
import { MAP } from '../src/data/map';
import { validatePlacement } from '../src/sim/build';
import { exec } from '../src/sim/commands';
import { createSim, deserialise, run, serialise, step, submit } from '../src/sim/world';
import { b, must } from './helpers';

const ore = MAP.deposits.find((d) => d.item === 'ore')!;

describe('M1: placement', () => {
  it('places an extractor on a deposit and refuses one off it', () => {
    const sim = createSim();
    const id = must(sim, { type: 'place', building: 'extractor', x: ore.x, z: ore.z, rot: 0 });
    expect(b(sim, id).extracts).toBe('ore');
    const r = exec(sim, { type: 'place', building: 'extractor', x: 120, z: 160, rot: 0 });
    expect(r).toEqual({ ok: false, reason: 'Must sit on a deposit.' });
  });

  it('refuses overlaps and blocked docks, allows touching', () => {
    const sim = createSim();
    must(sim, { type: 'place', building: 'smelter', x: 150, z: 140, rot: 0 });
    expect(validatePlacement(sim, 'smelter', 152, 140, 0)).toMatchObject({ ok: false, reason: 'Overlaps the smelter.' });
    // In front of its dock.
    expect(validatePlacement(sim, 'smelter', 150, 146, 0)).toMatchObject({ ok: false, reason: "Blocks the smelter's dock." });
    // Touching side by side is fine.
    expect(validatePlacement(sim, 'smelter', 155, 140, 0).ok).toBe(true);
    // Rotated so that its own dock runs into the first smelter.
    expect(validatePlacement(sim, 'smelter', 150, 134, 0)).toMatchObject({ ok: false, reason: 'Dock is blocked by the smelter.' });
  });

  it('refuses uneven ground and the map edge', () => {
    const sim = createSim();
    const p = MAP.plateaus[0];
    // Straddle the cliff on the far side from the ramp.
    const ang = p.ramp.angle + Math.PI;
    const x = p.x + Math.cos(ang) * p.rz;
    const z = p.z + Math.sin(ang) * p.rz;
    let found = false;
    for (let k = -8; k <= 8 && !found; k++) {
      const v = validatePlacement(sim, 'fabricator', x + Math.cos(ang) * k, z + Math.sin(ang) * k, 0);
      if (!v.ok && v.reason === 'Ground too uneven.') found = true;
    }
    expect(found).toBe(true);
    expect(validatePlacement(sim, 'smelter', 1, 100, 0)).toMatchObject({ ok: false, reason: 'Too close to the map edge.' });
  });
});

describe('M1: production', () => {
  it('extractor fills its output tray and then blocks', () => {
    const sim = createSim();
    const id = must(sim, { type: 'place', building: 'extractor', x: ore.x, z: ore.z, rot: 0 });
    // Haulers would empty it; this test is about the building alone.
    sim.state.haulers.length = 0;
    run(sim, 30 * 2 * 3 + 2);
    expect(b(sim, id).out.ore!.n).toBe(3);
    expect(b(sim, id).status).toBe('working');
    run(sim, 30 * 2 * 10);
    expect(b(sim, id).out.ore!.n).toBe(8);
    expect(b(sim, id).status).toBe('blocked');
  });

  it('smelter starves, then works when filled by a debug action', () => {
    const sim = createSim();
    sim.state.haulers.length = 0;
    const id = must(sim, { type: 'place', building: 'smelter', x: 150, z: 140, rot: 0.3 });
    run(sim, 5);
    expect(b(sim, id).status).toBe('starved');
    expect(b(sim, id).missing).toBe('ore');
    submit(sim, { type: 'debugFill', id });
    run(sim, 2);
    expect(b(sim, id).status).toBe('working');
    expect(b(sim, id).inp.ore!.n).toBe(6);
    run(sim, 30 * 4 * 4 + 5);
    expect(b(sim, id).out.plate!.n).toBe(4);
    expect(b(sim, id).status).toBe('starved');
  });

  it('changing recipe refunds inputs as leftovers on offer', () => {
    const sim = createSim();
    sim.state.haulers.length = 0;
    const id = must(sim, { type: 'place', building: 'fabricator', x: 150, z: 140, rot: 0 });
    expect(b(sim, id).recipe).toBe('part');
    must(sim, { type: 'debugFill', id });
    step(sim);
    expect(b(sim, id).crafting).toBe(true);
    must(sim, { type: 'setRecipe', id, recipe: 'frame' });
    const f = b(sim, id);
    expect(Object.keys(f.inp).sort()).toEqual(['plate', 'rock']);
    // 8 plates were filled; the plate slot is kept, and the 2 consumed by the
    // interrupted craft are refunded as leftovers.
    expect(f.inp.plate!.n).toBe(6);
    expect(f.out.plate!.n).toBe(2);
    expect(f.out.plate!.cap).toBe(0);
  });

  it('round-trips through JSON and stays in step', () => {
    const a = createSim();
    a.state.haulers.length = 0;
    must(a, { type: 'place', building: 'extractor', x: ore.x, z: ore.z, rot: 0 });
    const s = must(a, { type: 'place', building: 'smelter', x: 150, z: 140, rot: 0 });
    must(a, { type: 'debugFill', id: s });
    run(a, 100);
    const c = deserialise(serialise(a));
    run(a, 500);
    run(c, 500);
    expect(serialise(c)).toBe(serialise(a));
  });
});
