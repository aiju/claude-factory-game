import { describe, expect, it } from 'vitest';
import { ENCOUNTERS, encounter } from '../scripts/encounters';

// The open-ground cases from `npm run encounters`: haulers meeting with nothing
// else about. Every one arrives, none squeezes through another, and none takes
// much longer than driving the same route alone.
describe('M3.5: hauler encounters on open ground', () => {
  for (const [name, starts, max] of ENCOUNTERS) {
    it(name, () => {
      const o = encounter(name, starts, max);
      expect(o.times.every((t) => t !== null)).toBe(true);
      expect(o.squeezed).toBe(false);
      const limit = name.startsWith('three against three') ? 2 : 1.5;
      o.times.forEach((t, i) => expect(t! / o.free[i]).toBeLessThanOrEqual(limit));
    });
  }
});
