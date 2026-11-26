// Debug scenarios for screenshots and manual testing: a list of commands.
// Selected with ?scenario=name.

import type { Command } from '../sim/commands';
import type { Game } from '../game';
import type { ItemId } from '../data/items';

const D = Math.PI / 180;

export const SCENARIOS: Record<string, () => Command[]> = {
  /** M1: one of each building, inputs filled by hand. Haulers removed. */
  m1: () => [
    { type: 'place', building: 'extractor', x: 152, z: 104, rot: 20 * D },
    { type: 'place', building: 'smelter', x: 141, z: 110, rot: 0 },
    { type: 'place', building: 'fabricator', x: 158, z: 118, rot: -30 * D },
    { type: 'place', building: 'fabricator', x: 136, z: 100, rot: 0, recipe: 'frame' },
  ],
  /** Design showroom: one of each building with full trays, and haulers posed nearby. */
  showroom: () => [
    { type: 'place', building: 'extractor', x: 152, z: 104, rot: 20 * D },
    { type: 'place', building: 'smelter', x: 141, z: 108, rot: 0 },
    { type: 'place', building: 'fabricator', x: 152, z: 116, rot: 0 },
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
  if (name === 'm1' || name === 'showroom') for (const id of ids) game.command({ type: 'debugFill', id });
  if (name === 'showroom') {
    // A still life. Run the buildings briefly without haulers so they are
    // caught mid-craft, then pose everything by poking state directly.
    const st = game.sim.state;
    const fleet = st.haulers.splice(0);
    game.warp(100);
    st.haulers.push(...fleet);
    for (const b of st.buildings) {
      const outs = Object.values(b.out);
      outs.forEach((s) => (s.n = 5));
      if (b.store) Object.values(b.store).forEach((s, k) => (s.n = [30, 14, 6, 22, 9, 3][k % 6]));
    }
    const poses: [number, number, number, ItemId | null, number][] = [
      [140, 116, 40, 'ore', 4],
      [142.6, 116.6, -150, 'plate', 4],
      [137.5, 117.5, 100, null, 0],
      [144, 119.5, -20, 'part', 3],
      [139.5, 120.5, 170, 'frame', 2],
      [146.5, 116.5, -80, 'coal', 4],
    ];
    st.haulers.forEach((h, i) => {
      const p = poses[i % poses.length];
      h.x = p[0];
      h.z = p[1];
      h.heading = p[2] * D;
      h.cargo = p[3];
      h.cargoN = p[4];
    });
  }
}
