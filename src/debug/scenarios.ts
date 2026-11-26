// Debug scenarios for screenshots and manual testing: a list of commands.
// Selected with ?scenario=name.

import type { Command } from '../sim/commands';
import type { Game } from '../game';

const D = Math.PI / 180;

export const SCENARIOS: Record<string, () => Command[]> = {
  /** M1: one of each building, inputs filled by hand. Haulers removed. */
  m1: () => [
    { type: 'place', building: 'extractor', x: 152, z: 104, rot: 20 * D },
    { type: 'place', building: 'smelter', x: 141, z: 110, rot: 0 },
    { type: 'place', building: 'fabricator', x: 158, z: 118, rot: -30 * D },
    { type: 'place', building: 'fabricator', x: 136, z: 100, rot: 0, recipe: 'frame' },
  ],
  /** M2: extractor → smelter → fabricator → hub, haulers only. */
  m2: () => [
    { type: 'place', building: 'extractor', x: 152, z: 104, rot: -60 * D },
    { type: 'place', building: 'extractor', x: 157, z: 107, rot: -20 * D },
    { type: 'place', building: 'smelter', x: 141, z: 112, rot: 150 * D },
    { type: 'place', building: 'smelter', x: 147, z: 119, rot: 180 * D },
    { type: 'place', building: 'fabricator', x: 112, z: 116, rot: 90 * D },
  ],
  /** As m2 but with two haulers, to show starving and blocking. */
  'm2-small': () => SCENARIOS.m2(),
};

export function runScenario(game: Game, name: string) {
  const make = SCENARIOS[name];
  if (!make) return;
  if (name === 'm1') game.sim.state.haulers.length = 0;
  if (name === 'm2-small') game.sim.state.haulers.length = 2;
  const ids: number[] = [];
  for (const cmd of make()) {
    const r = game.command(cmd);
    if (!r.ok) console.warn(`scenario ${name}: ${cmd.type} refused: ${r.reason}`);
    else if (r.id) ids.push(r.id);
  }
  if (name === 'm1') for (const id of ids) game.command({ type: 'debugFill', id });
}
