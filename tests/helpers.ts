import type { Command } from '../src/sim/commands';
import { exec } from '../src/sim/commands';
import type { Sim } from '../src/sim/world';

/** Apply a command now and insist it succeeds. Returns the new id, if any. */
export function must(sim: Sim, cmd: Command): number {
  const r = exec(sim, cmd);
  if (!r.ok) throw new Error(`${cmd.type} refused: ${r.reason}`);
  return r.id ?? 0;
}

export function b(sim: Sim, id: number) {
  const x = sim.d.byId.get(id);
  if (!x) throw new Error(`no building ${id}`);
  return x;
}
