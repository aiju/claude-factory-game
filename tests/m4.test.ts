import { describe, expect, it } from 'vitest';
import { LINK } from '../src/data/links';
import { HAULER } from '../src/data/tunables';
import { validatePlacement } from '../src/sim/build';
import { exec } from '../src/sim/commands';
import { checkReservations } from '../src/sim/haul';
import { planLink, sockets } from '../src/sim/links';
import { createSim, deserialise, hubOf, run, serialise, type Sim } from '../src/sim/world';
import { b, must } from './helpers';

const D = Math.PI / 180;

/** The M2 chain: two extractors on ore, two smelters, one fabricator. */
function chain(sim: Sim) {
  return {
    ex1: must(sim, { type: 'place', building: 'extractor', x: 152, z: 104, rot: -60 * D }),
    ex2: must(sim, { type: 'place', building: 'extractor', x: 157, z: 107, rot: -20 * D }),
    sm1: must(sim, { type: 'place', building: 'smelter', x: 141, z: 112, rot: 150 * D }),
    sm2: must(sim, { type: 'place', building: 'smelter', x: 147, z: 119, rot: 180 * D }),
    fab: must(sim, { type: 'place', building: 'fabricator', x: 112, z: 116, rot: 90 * D }),
  };
}

/** Every item in the world: buffers, hub, haulers, links. */
function itemCount(sim: Sim) {
  let n = 0;
  for (const x of sim.state.buildings) {
    for (const s of [...Object.values(x.inp), ...Object.values(x.out), ...Object.values(x.store ?? {})]) n += s!.n;
    for (const v of Object.values(x.consumed)) n += v!;
  }
  for (const h of sim.state.haulers) n += h.cargoN;
  for (const l of sim.state.links) n += l.items.length;
  return n;
}

function roadCells(sim: Sim) {
  let n = 0;
  for (const l of sim.state.ground.level) if (l === 2) n++;
  return n;
}

describe('M4: links', () => {
  it('a conveyor feeds a smelter, and the smelter stops asking haulers for ore', () => {
    const sim = createSim();
    const ids = chain(sim);
    const link = must(sim, { type: 'link', from: ids.ex1, to: ids.sm1 });
    const l = sim.state.links.find((x) => x.id === link)!;
    expect(l.type).toBe('conveyor');
    expect(l.supports.length).toBeGreaterThan(0);
    let oreJobsToSm1 = 0;
    for (let t = 0; t < 30 * 180; t++) {
      run(sim, 1);
      if (sim.state.jobs.some((j) => j.to === ids.sm1 && j.item === 'ore' && j.created === sim.state.tick - 1)) oreJobsToSm1++;
    }
    expect(oreJobsToSm1).toBe(0);
    expect(l.moved).toBeGreaterThan(50);
    expect(b(sim, ids.sm1).made).toBeGreaterThan(20);
    expect(checkReservations(sim)).toEqual([]);
  });

  it('a conveyor moves about two items a second', () => {
    const sim = createSim();
    // Hub to a smelter: the hub has plenty of ore to give.
    must(sim, { type: 'debugStock', item: 'ore', n: 500 });
    const sm = must(sim, { type: 'place', building: 'smelter', x: 140, z: 140, rot: 0 });
    must(sim, { type: 'link', from: sim.state.hub, to: sm });
    const l = sim.state.links[0];
    run(sim, 30 * 60);
    // Keep the smelter's input from filling, so only the belt limits the rate.
    const before = l.moved;
    for (let t = 0; t < 30 * 30; t++) {
      b(sim, sm).inp.ore!.n = 0;
      run(sim, 1);
    }
    const rate = (l.moved - before) / 30;
    expect(rate).toBeGreaterThan(1.8);
    expect(rate).toBeLessThan(2.1);
  });

  it('two buildings side by side are joined by an arm', () => {
    const sim = createSim();
    // A smelter with its right side facing an extractor's left side, 2 m apart.
    const ex = must(sim, { type: 'place', building: 'extractor', x: 152, z: 104, rot: 0 });
    const sm = must(sim, { type: 'place', building: 'smelter', x: 152 - 2 - 2 - 2.5, z: 104, rot: 0 });
    const plan = planLink(sim, ex, sm);
    expect(plan.ok && plan.type).toBe('arm');
    must(sim, { type: 'link', from: ex, to: sm });
    const l = sim.state.links[0];
    run(sim, 30 * 120);
    expect(l.moved).toBeGreaterThan(40);
    expect(b(sim, sm).made).toBeGreaterThan(15);
    // No hauler carried ore to it.
    expect(sim.state.jobs.some((j) => j.to === sm)).toBe(false);
  });

  it('conveyors cross at different heights', () => {
    const sim = createSim();
    // Smelter → fabricator west to east, then another north to south across it.
    const s1 = must(sim, { type: 'place', building: 'smelter', x: 104, z: 100, rot: 90 * D });
    const f1 = must(sim, { type: 'place', building: 'fabricator', x: 146, z: 98, rot: -90 * D });
    const s2 = must(sim, { type: 'place', building: 'smelter', x: 126, z: 88, rot: 0 });
    const f2 = must(sim, { type: 'place', building: 'fabricator', x: 128, z: 112, rot: 180 * D });
    const ia = must(sim, { type: 'link', from: s1, to: f1 });
    const ic = must(sim, { type: 'link', from: s2, to: f2 });
    const a = sim.state.links.find((l) => l.id === ia)!;
    const c = sim.state.links.find((l) => l.id === ic)!;
    expect(c.height).toBeGreaterThanOrEqual(a.height + LINK.tierStep - 1e-6);
  });

  it('refuses links that carry nothing, and says why', () => {
    const sim = createSim();
    const ids = chain(sim);
    const r = exec(sim, { type: 'link', from: ids.ex1, to: ids.fab });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/^Nothing to carry/);
    must(sim, { type: 'link', from: ids.ex1, to: ids.sm1 });
    const again = exec(sim, { type: 'link', from: ids.ex1, to: ids.sm1 });
    expect(!again.ok && again.reason).toBe('Already linked.');
  });

  it('supports are solid: buildings refuse to sit on them and routes go round', () => {
    const sim = createSim();
    const ids = chain(sim);
    must(sim, { type: 'link', from: ids.sm1, to: ids.fab });
    const l = sim.state.links[0];
    const [sx, sz] = [l.supports[0], l.supports[1]];
    const v = validatePlacement(sim, 'smelter', sx, sz, 0);
    expect(v.ok).toBe(false);
    const nav = sim.d.nav;
    expect(nav.occ[Math.floor(sz) * nav.size + Math.floor(sx)]).toBeGreaterThan(0);
    expect(LINK.supportRadius).toBeGreaterThan(0);
  });

  it('demolishing and unlinking lose nothing and leave no reservations', () => {
    const sim = createSim();
    const ids = chain(sim);
    must(sim, { type: 'link', from: ids.ex1, to: ids.sm1 });
    must(sim, { type: 'link', from: ids.ex2, to: ids.sm2 });
    must(sim, { type: 'link', from: ids.sm1, to: ids.fab });
    run(sim, 30 * 90);
    expect(sim.state.links.every((l) => l.items.length > 0 || l.moved > 0)).toBe(true);
    // Count what exists, ignoring what extractors make in the meantime.
    const before = itemCount(sim);
    must(sim, { type: 'unlink', id: sim.state.links[0].id });
    expect(itemCount(sim)).toBe(before);
    must(sim, { type: 'demolish', id: ids.sm1 });
    const lost = sim.state.links.some((l) => l.from === ids.sm1 || l.to === ids.sm1);
    expect(lost).toBe(false);
    expect(checkReservations(sim)).toEqual([]);
    run(sim, 30 * 60);
    expect(checkReservations(sim)).toEqual([]);
  });

  it('links survive a save and load', () => {
    const sim = createSim();
    const ids = chain(sim);
    must(sim, { type: 'link', from: ids.ex1, to: ids.sm1 });
    run(sim, 30 * 40);
    const copy = deserialise(serialise(sim));
    expect(copy.state.links).toEqual(sim.state.links);
    run(sim, 300);
    run(copy, 300);
    expect(serialise(copy)).toBe(serialise(sim));
  });

  it('sockets are on the back and sides, never the dock face', () => {
    const sim = createSim();
    const hub = hubOf(sim);
    for (const s of sockets(hub)) expect(s.nz).toBeLessThan(0.5);
  });

  it('replacing the busy hauler routes with conveyors frees haulers and lets the road fade', () => {
    const sim = createSim();
    const ids = chain(sim);
    run(sim, 30 * 60 * 6);
    const roadBefore = roadCells(sim);
    let busyBefore = 0;
    for (let t = 0; t < 30 * 60; t++) {
      run(sim, 1);
      busyBefore += sim.state.haulers.filter((h) => h.job !== null).length;
    }
    for (const [from, to] of [
      [ids.ex1, ids.sm1],
      [ids.ex2, ids.sm2],
      [ids.sm1, ids.fab],
      [ids.sm2, ids.fab],
    ]) must(sim, { type: 'link', from, to });
    run(sim, 30 * 60 * 10);
    let busyAfter = 0;
    for (let t = 0; t < 30 * 60; t++) {
      run(sim, 1);
      busyAfter += sim.state.haulers.filter((h) => h.job !== null).length;
    }
    expect(roadBefore).toBeGreaterThan(50);
    expect(roadCells(sim)).toBeLessThan(roadBefore * 0.4);
    expect(busyAfter).toBeLessThan(busyBefore * 0.5);
    expect(hubOf(sim).store!.part!.n).toBeGreaterThan(30);
    expect(HAULER.capacity).toBeGreaterThan(0);
  });
});
