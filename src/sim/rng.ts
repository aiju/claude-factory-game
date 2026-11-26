// Seeded RNG and hashing. The sim never uses Math.random.

/** mulberry32 step: returns [value in [0,1), next state]. */
export function rngNext(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** A small stateful wrapper for generation code (terrain, scatter). */
export class Rng {
  constructor(public state: number) {}
  next(): number {
    const [v, s] = rngNext(this.state);
    this.state = s;
    return v;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

/** Integer hash of two ints and a seed, to [0,1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ seed) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
