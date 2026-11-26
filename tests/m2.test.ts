import { describe, expect, it } from 'vitest';
import { MAP } from '../src/data/map';
import { validatePlacement } from '../src/sim/build';
import { checkReservations } from '../src/sim/haul';
import { findPath } from '../src/sim/nav';
import { createSim, deserialise, hubOf, run, serialise, type Sim } from '../src/sim/world';
import { b, must } from './helpers';

const D = Math.PI / 180;

function pathLength(sx: number, sz: number, p: number[]) {
  let d = 0;
  let x = sx;
  let z = sz;
  for (let k = 0; k < p.length; k += 2) {
    d += Math.hypot(p[k] - x, p[k + 1] - z);
    x = p[k];
    z = p[k + 1];
  }
  return d;
}

/** The M2 chain: two extractors on ore, two smelters, one fabricator, the hub. */
function chain(sim: Sim) {
  return {
    ex1: must(sim, { type: 'place', building: 'extractor', x: 152, z: 104, rot: -60 * D }),
    ex2: must(sim, { type: 'place', building: 'extractor', x: 157, z: 107, rot: -20 * D }),
    sm1: must(sim, { type: 'place', building: 'smelter', x: 141, z: 112, rot: 150 * D }),
    sm2: must(sim, { type: 'place', building: 'smelter', x: 147, z: 119, rot: 180 * D }),
    fab: must(sim, { type: 'place', building: 'fabricator', x: 112, z: 116, rot: 90 * D }),
  };
}

function expectClean(sim: Sim) {
  expect(checkReservations(sim)).toEqual([]);
}

describe('M2: navigation', () => {
  it('finds a path around a building', () => {
    const sim = createSim();
    must(sim, { type: 'place', building: 'fabricator', x: 150, z: 150, rot: 0 });
    const p = findPath(sim, 150, 143, 150, 158)!;
    expect(p).not.toBeNull();
    expect(p.slice(-2)).toEqual([150, 158]);
    expect(pathLength(150, 143, p)).toBeGreaterThan(15);
    expect(pathLength(150, 143, p)).toBeLessThan(30);
  });

  it('goes up a plateau by its ramp, not its cliff', () => {
    const sim = createSim();
    const pl = MAP.plateaus[0];
    // From outside the cliff side to the middle of the plateau.
    const ang = pl.ramp.angle + Math.PI;
    const sx = pl.x + Math.cos(ang) * (pl.rz + 12);
    const sz = pl.z + Math.sin(ang) * (pl.rz + 12);
    const p = findPath(sim, sx, sz, pl.x, pl.z)!;
    expect(p).not.toBeNull();
    expect(pathLength(sx, sz, p)).toBeGreaterThan(Math.hypot(sx - pl.x, sz - pl.z) * 1.5);
  });

  it('refuses a placement that cuts a dock off from the hub', () => {
    const sim = createSim();
    must(sim, { type: 'place', building: 'smelter', x: 150, z: 140, rot: 0 });
    must(sim, { type: 'place', building: 'fabricator', x: 145, z: 144, rot: -90 * D });
    must(sim, { type: 'place', building: 'fabricator', x: 155, z: 144, rot: 90 * D });
    const v = validatePlacement(sim, 'fabricator', 150, 150.5, 0);
    expect(v).toEqual({ ok: false, reason: 'Cuts off the smelter from the hub.' });
  });
});

describe('M2: haulers', () => {
  it('runs extractor → smelter → fabricator → hub with haulers only', () => {
    const sim = createSim();
    const ids = chain(sim);
    for (let m = 0; m < 10; m++) {
      run(sim, 30 * 60);
      expectClean(sim);
    }
    const hub = hubOf(sim);
    expect(b(sim, ids.fab).made).toBeGreaterThan(10);
    expect(hub.store!.part!.n).toBeGreaterThan(5);
    // Everything that was made is somewhere.
    expect(b(sim, ids.sm1).made + b(sim, ids.sm2).made).toBeGreaterThan(40);
  });

  it('leaves no reservations behind once everything is demolished', () => {
    const sim = createSim();
    const ids = chain(sim);
    run(sim, 30 * 90);
    expect(sim.state.jobs.length).toBeGreaterThan(0);
    for (const id of Object.values(ids)) must(sim, { type: 'demolish', id });
    expectClean(sim);
    // Time to deliver what they carry to the hub, then park one by one.
    run(sim, 30 * 120);
    expect(sim.state.jobs).toEqual([]);
    expect(sim.state.haulers.every((h) => h.mode === 'idle' && h.cargo === null)).toBe(true);
    expectClean(sim);
    // Nothing is lost: what was in transit is now in the hub.
    expect(sim.state.buildings.length).toBe(1);
  });

  it('a loaded hauler whose destination disappears takes its cargo to the hub', () => {
    const sim = createSim();
    const ids = chain(sim);
    let job = null;
    for (let t = 0; t < 30 * 120 && !job; t++) {
      run(sim, 1);
      job = sim.state.jobs.find((j) => j.loaded && j.to === ids.sm1) ?? null;
    }
    expect(job).not.toBeNull();
    const h = sim.state.haulers.find((x) => x.id === job!.hauler)!;
    must(sim, { type: 'demolish', id: ids.sm1 });
    expectClean(sim);
    expect(job!.to).toBe(sim.state.hub);
    // Watch that hauler unload at the hub (other haulers may take the ore
    // straight back out again, so the hub's count alone proves nothing).
    let delivered = false;
    for (let t = 0; t < 30 * 60 && !delivered; t++) {
      const wasUnloading = h.mode === 'unloading' && h.job === job!.id;
      run(sim, 1);
      if (wasUnloading && !sim.state.jobs.includes(job!)) delivered = true;
    }
    expect(delivered).toBe(true);
    expect(h.cargo).toBeNull();
    expectClean(sim);
  });

  it('with too few haulers, buildings visibly starve and block', () => {
    const sim = createSim();
    sim.state.haulers.length = 1;
    const ids = chain(sim);
    let starved = 0;
    let blocked = 0;
    const T = 30 * 300;
    for (let t = 0; t < T; t++) {
      run(sim, 1);
      if (b(sim, ids.fab).status === 'starved') starved++;
      if (b(sim, ids.ex1).status === 'blocked') blocked++;
    }
    expect(starved / T).toBeGreaterThan(0.5);
    expect(blocked / T).toBeGreaterThan(0.3);
    expectClean(sim);
  });

  it('is reproducible across a save and load', () => {
    const a = createSim();
    chain(a);
    run(a, 30 * 45);
    const c = deserialise(serialise(a));
    run(a, 30 * 45);
    run(c, 30 * 45);
    expect(serialise(c)).toBe(serialise(a));
  });

  it('haulers park back in their bays', () => {
    const sim = createSim();
    const id = must(sim, { type: 'place', building: 'smelter', x: 140, z: 150, rot: 0 });
    // Give the smelter something to ask for, from the hub.
    hubOf(sim).store!.ore!.n = 8;
    run(sim, 30 * 60);
    expect(b(sim, id).inp.ore!.n + b(sim, id).made * 2).toBe(8);
    expect(sim.state.haulers.every((h) => h.mode === 'idle')).toBe(true);
    expectClean(sim);
  });
});
