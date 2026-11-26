// Hauler encounters on open ground, timed against driving the same route
// alone. No buildings, no trees, nothing in the way but each other: every
// case here should cost a few seconds at most.
//
//   npm run encounters
//
// A hauler that never arrives, or that only gets through by squeezing
// (driving through another), is a failure of the movement rules.

import { createSim, step } from '../src/sim/world';
import { HAULER, TICK_RATE } from '../src/data/tunables';
import type { Hauler } from '../src/sim/types';

interface Start {
  x: number;
  z: number;
  /** Heading, radians: 0 is +Z, π/2 is +X. */
  heading: number;
  /** Where to drive to; omit for a hauler that just stands there. */
  to?: [number, number];
}

export interface Outcome {
  name: string;
  /** Seconds taken per driving hauler, or null if it never arrived. */
  times: (number | null)[];
  free: number[];
  shunts: number;
  squeezed: boolean;
}

export function encounter(name: string, starts: Start[], maxSeconds = 60): Outcome {
  const sim = createSim();
  const hs = sim.state.haulers;
  hs.length = Math.min(hs.length, starts.length);
  while (hs.length < starts.length) hs.push({ ...hs[0], id: sim.state.nextId++ });
  starts.forEach((p, i) => {
    const h: Hauler = hs[i];
    Object.assign(h, { x: p.x, z: p.z, heading: p.heading, speed: 0, hold: 0, wait: 0, squeeze: 0, man: 'drive', manT: 99, mdir: 1, revFrom: -1, best: Infinity, bestT: 0, job: null, cargo: null, cargoN: 0 });
    if (p.to) Object.assign(h, { mode: 'drop', path: [p.x, p.z, p.to[0], p.to[1]], pathI: 1 });
    else Object.assign(h, { mode: 'loading', timer: 1e9, path: [], pathI: 0 });
  });
  const times: (number | null)[] = starts.map((p) => (p.to ? null : 0));
  const was = hs.map(() => 'drive');
  let shunts = 0;
  let squeezed = false;
  for (let t = 1; t <= maxSeconds * TICK_RATE && times.some((d) => d === null); t++) {
    step(sim);
    hs.forEach((h, i) => {
      if (times[i] !== null) return;
      if (h.squeeze > 0) squeezed = true;
      if (h.man === 'shunt' && was[i] !== 'shunt') shunts++;
      was[i] = h.man;
      const to = starts[i].to!;
      if (Math.hypot(h.x - to[0], h.z - to[1]) < 0.9) {
        times[i] = t / TICK_RATE;
        // Out of the way, so it doesn't become an obstacle for the rest.
        Object.assign(h, { mode: 'loading', timer: 1e9, path: [], pathI: 0, x: 3 + i * 4, z: 3 });
      }
    });
  }
  const free = starts.filter((p) => p.to).map((p) => Math.hypot(p.to![0] - p.x, p.to![1] - p.z) / HAULER.speed + 1.5);
  return { name, times: times.filter((_, i) => starts[i].to), free, shunts, squeezed };
}

const E = Math.PI / 2;
const W = -Math.PI / 2;
const N = 0;

export const ENCOUNTERS: [string, Start[], number?][] = [
  ['alone, 30 m straight', [{ x: 150, z: 140, heading: E, to: [180, 140] }]],
  ['head-on, same line', [{ x: 150, z: 140, heading: E, to: [180, 140] }, { x: 180, z: 140, heading: W, to: [150, 140] }]],
  ['head-on, lines 1 m apart', [{ x: 150, z: 140, heading: E, to: [180, 140] }, { x: 180, z: 141, heading: W, to: [150, 141] }]],
  ['head-on, lines 2 m apart (no conflict)', [{ x: 150, z: 140, heading: E, to: [180, 140] }, { x: 180, z: 142, heading: W, to: [150, 142] }]],
  ['crossing at 90°', [{ x: 150, z: 140, heading: E, to: [180, 140] }, { x: 165, z: 125, heading: N, to: [165, 155] }]],
  ['crossing at 45°', [{ x: 150, z: 140, heading: E, to: [180, 140] }, { x: 154, z: 129, heading: 0.78, to: [176, 151] }]],
  ['standing hauler on the line, end on', [{ x: 150, z: 140, heading: E, to: [180, 140] }, { x: 165, z: 140, heading: E }]],
  ['standing hauler on the line, broadside', [{ x: 150, z: 140, heading: E, to: [180, 140] }, { x: 165, z: 140, heading: N }]],
  ['standing hauler 1 m off the line', [{ x: 150, z: 140, heading: E, to: [180, 140] }, { x: 165, z: 141, heading: E }]],
  ['between two standing haulers, 4 m apart', [{ x: 150, z: 140, heading: E, to: [180, 140] }, { x: 165, z: 138, heading: N }, { x: 165, z: 142, heading: N }]],
  ['following, same way', [{ x: 150, z: 140, heading: E, to: [180, 140] }, { x: 146, z: 140, heading: E, to: [180, 140.5] }]],
  [
    'three against three, same line',
    [0, 1, 2].flatMap((i) => [
      { x: 150 + i * 3, z: 140, heading: E, to: [190 + i * 3, 140] as [number, number] },
      { x: 196 - i * 3, z: 140, heading: W, to: [144 - i * 3, 140] as [number, number] },
    ]),
    120,
  ],
];

if (process.argv[1]?.endsWith('encounters.ts')) {
  console.log('case'.padEnd(42) + 'worst / free   shunts');
  for (const [name, starts, max] of ENCOUNTERS) {
    const o = encounter(name, starts, max);
    const ratios = o.times.map((t, i) => (t === null ? Infinity : t / o.free[i]));
    const worst = Math.max(...ratios);
    const verdict = !isFinite(worst) ? 'NEVER ARRIVES' : o.squeezed ? 'squeezed through' : worst > 1.5 ? 'slow' : 'ok';
    console.log(`${name.padEnd(42)}${(isFinite(worst) ? worst.toFixed(1) + '×' : '∞').padEnd(15)}${String(o.shunts).padEnd(7)}${verdict}`);
  }
}
