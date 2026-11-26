import { describe, expect, it } from 'vitest';
import { gapScenario } from '../src/debug/scenarios';
import { HAULER, WEAR } from '../src/data/tunables';
import { exec } from '../src/sim/commands';
import { checkReservations } from '../src/sim/haul';
import { findPath } from '../src/sim/nav';
import { createSim, run, type Sim } from '../src/sim/world';
import { must } from './helpers';

const D = Math.PI / 180;

function chain(sim: Sim) {
  return [
    must(sim, { type: 'place', building: 'extractor', x: 152, z: 104, rot: -60 * D }),
    must(sim, { type: 'place', building: 'extractor', x: 157, z: 107, rot: -20 * D }),
    must(sim, { type: 'place', building: 'smelter', x: 141, z: 112, rot: 150 * D }),
    must(sim, { type: 'place', building: 'smelter', x: 147, z: 119, rot: 180 * D }),
    must(sim, { type: 'place', building: 'fabricator', x: 112, z: 116, rot: 90 * D }),
  ];
}

function levels(sim: Sim) {
  let track = 0;
  let road = 0;
  for (const l of sim.state.ground.level) {
    if (l === 1) track++;
    if (l === 2) road++;
  }
  return { track, road };
}

/** Lay road by hand along a polyline, 3 m wide. */
function layRoad(sim: Sim, pts: [number, number][]) {
  const g = sim.state.ground;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k];
    const [bx, bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s <= len * 4; s++) {
      const x = ax + ((bx - ax) * s) / (len * 4);
      const z = az + ((bz - az) * s) / (len * 4);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = (Math.floor(z) + dz) * g.size + Math.floor(x) + dx;
          g.level[i] = 2;
          g.wear[i] = WEAR.max;
        }
      }
    }
  }
}

describe('M3: wear and roads', () => {
  it('a busy route becomes a road within a few minutes, and fades once abandoned', () => {
    const sim = createSim();
    const ids = chain(sim);
    run(sim, 30 * 60 * 2);
    const early = levels(sim);
    expect(early.track).toBeGreaterThan(30);
    run(sim, 30 * 60 * 3);
    const busy = levels(sim);
    expect(busy.road).toBeGreaterThan(10);
    for (const id of ids) must(sim, { type: 'demolish', id });
    run(sim, 30 * 60 * 5);
    // Fading, not gone.
    expect(levels(sim).track + levels(sim).road).toBeGreaterThan(0);
    run(sim, 30 * 60 * 20);
    expect(levels(sim)).toEqual({ track: 0, road: 0 });
  });

  it('pathfinding prefers a road over a slightly shorter way across grass', () => {
    const sim = createSim();
    const a: [number, number] = [108, 142];
    const b: [number, number] = [148, 142];
    const plain = findPath(sim, ...a, ...b)!;
    // Straight across, without a road.
    expect(plain.length / 2).toBeLessThanOrEqual(2);
    layRoad(sim, [a, [128, 150], b]);
    const p = findPath(sim, ...a, ...b)!;
    // It bends out towards the road (straight across would stay at z = 142).
    const maxZ = Math.max(...p.filter((_, k) => k % 2 === 1));
    expect(maxZ).toBeGreaterThan(147);
  });

  it('haulers drive faster on roads', () => {
    const sim = createSim();
    chain(sim);
    let top = 0;
    for (let t = 0; t < 30 * 60 * 8; t++) {
      run(sim, 1);
      for (const h of sim.state.haulers) top = Math.max(top, h.speed);
    }
    expect(top).toBeGreaterThan(HAULER.speed * 1.4);
  });
});

describe('M3: congestion', () => {
  it('haulers meeting head-on pass without driving through each other', () => {
    const sim = createSim();
    const [h1, h2] = sim.state.haulers;
    const z = 150;
    Object.assign(h1, { x: 110, z, heading: 90 * D, mode: 'home', path: [110, z, 146, z], pathI: 1, hold: 0 });
    Object.assign(h2, { x: 146, z, heading: -90 * D, mode: 'home', path: [146, z, 110, z], pathI: 1, hold: 0 });
    let minD = Infinity;
    for (let t = 0; t < 30 * 25; t++) {
      run(sim, 1);
      if (h1.mode === 'home' && h2.mode === 'home') minD = Math.min(minD, Math.hypot(h1.x - h2.x, h1.z - h2.z));
    }
    expect(minD).toBeGreaterThan(1.1);
    // Both got where they were going (and then headed for their bays).
    expect(h1.odo).toBeGreaterThan(34);
    expect(h2.odo).toBeGreaterThan(34);
  });

  it('a narrow gap between buildings jams, but never locks up', () => {
    const sim = createSim();
    const gapX = 136;
    for (const cmd of gapScenario(gapX, 3, 24)) exec(sim, cmd);
    let inGap = 0;
    let slow = 0;
    let peak = 0;
    const last = new Map<number, [number, number]>();
    let stall = 0;
    for (let t = 0; t < 30 * 60 * 6; t++) {
      run(sim, 1);
      for (const h of sim.state.haulers) {
        const l = last.get(h.id);
        if (!l || h.odo - l[0] > 1 || h.mode === 'idle' || h.mode === 'loading' || h.mode === 'unloading') last.set(h.id, [h.odo, t]);
        else stall = Math.max(stall, t - l[1]);
        if (t > 30 * 60 && h.mode !== 'idle' && Math.abs(h.x - gapX) < 3 && Math.abs(h.z - 114) < 5) {
          inGap++;
          if (h.speed < 1) slow++;
        }
      }
      const g = sim.state.ground;
      peak = Math.max(peak, g.crowd[114 * g.size + gapX]);
    }
    expect(slow / inGap).toBeGreaterThan(0.3);
    // Solid haulers can't pack as densely as overlapping ones did.
    expect(peak).toBeGreaterThan(1.2);
    // Backing off, re-planning and, last of all, squeezing past keep it moving.
    expect(stall).toBeLessThan(45 * 30);
    expect(checkReservations(sim)).toEqual([]);
  });
});
