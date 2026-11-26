// Haulers and the dispatcher (M2).
import type { CommandResult } from './commands';
import type { Sim } from './world';

export function cancelJobsFor(_sim: Sim, _id: number, _inboundOnly: boolean) {}
export function addHaulers(_sim: Sim, _n: number): CommandResult {
  return { ok: false, reason: 'Haulers are not built yet.' };
}
export function tickHaulers(_sim: Sim) {}
