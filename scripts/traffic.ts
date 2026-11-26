// How haulers spend their time on the road in a scenario, and where they
// stall. Use it to judge a change to movement or traffic rules.
//
//   npm run traffic                 the M2 chain with 1, 6 and 12 haulers
//   npm run traffic -- m3-gap 30    a named scenario and a fleet size

import { SCENARIOS } from '../src/debug/scenarios';
import { TICK_RATE } from '../src/data/tunables';
import { exec } from '../src/sim/commands';
import { createSim, step } from '../src/sim/world';

function report(scenario: string, fleet: number, minutes = 10) {
  const sim = createSim();
  for (const c of SCENARIOS[scenario]()) exec(sim, c);
  const st = sim.state;
  if (fleet < st.haulers.length) st.haulers.length = fleet;
  else if (fleet > st.haulers.length) exec(sim, { type: 'debugAddHaulers', count: fleet - st.haulers.length });
  let road = 0, fast = 0, stopped = 0, shunt = 0, pivot = 0, squeeze = 0;
  const since = new Map<number, { t: number; x: number; z: number }>();
  const stalls: { s: number; x: number; z: number; near: boolean }[] = [];
  const ticks = minutes * 60 * TICK_RATE;
  for (let t = 0; t < ticks; t++) {
    step(sim);
    for (const h of st.haulers) {
      if (h.mode === 'idle' || h.mode === 'loading' || h.mode === 'unloading' || h.path.length === 0 || h.hold > 0) continue;
      road++;
      if (h.speed > 3) fast++;
      if (h.man === 'shunt') shunt++;
      if (h.man === 'pivot') pivot++;
      if (h.squeeze > 0) squeeze++;
      const s0 = since.get(h.id);
      if (h.speed < 0.05) {
        stopped++;
        if (!s0) since.set(h.id, { t, x: h.x, z: h.z });
      } else if (s0) {
        since.delete(h.id);
        const s = (t - s0.t) / TICK_RATE;
        if (s >= 1.5) stalls.push({ s, x: s0.x, z: s0.z, near: st.haulers.some((o) => o !== h && Math.hypot(o.x - s0.x, o.z - s0.z) < 3) });
      }
    }
  }
  const hub = st.buildings.find((b) => b.type === 'hub')!;
  const pc = (n: number) => `${((100 * n) / Math.max(1, road)).toFixed(0)}%`;
  const total = (l: typeof stalls) => `${l.length} (${l.reduce((a, s) => a + s.s, 0).toFixed(0)} s)`;
  const odo = st.haulers.reduce((a, h) => a + h.odo, 0) / st.haulers.length;
  console.log(`\n${scenario}, ${fleet} haulers, ${minutes} min: ${hub.store?.part?.n ?? 0} parts, ${odo.toFixed(0)} m driven each`);
  console.log(`  road time: at speed ${pc(fast)}, stopped ${pc(stopped)}, shunting ${pc(shunt)}, pivoting ${pc(pivot)}, squeezing ${pc(squeeze)}`);
  console.log(`  stalls ≥ 1.5 s: ${total(stalls)}; alone ${total(stalls.filter((s) => !s.near))}; longer than 10 s ${total(stalls.filter((s) => s.s > 10))}`);
  const worst = stalls.sort((a, b) => b.s - a.s).slice(0, 5).map((s) => `${s.s.toFixed(0)} s at (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`);
  if (worst.length) console.log(`  worst: ${worst.join('; ')}`);
}

const [scenario, fleet] = process.argv.slice(2);
if (scenario) report(scenario, Number(fleet ?? 6));
else for (const n of [1, 6, 12]) report('m2', n);
