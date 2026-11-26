// Link types and the numbers that shape them. See "Links" in docs/design.md.

export type LinkTypeId = 'conveyor' | 'arm';

export interface LinkTypeDef {
  id: LinkTypeId;
  name: string;
  /** Socket-to-socket distance this type covers, metres (horizontal). */
  minReach: number;
  maxReach: number;
  /** Item speed along the link, m/s, and least gap between items, metres.
   *  Throughput is speed / spacing. An arm's spacing is its own length: one
   *  item at a time. */
  speed: number;
  spacing: number;
}

export const LINK_TYPES: Record<LinkTypeId, LinkTypeDef> = {
  // About 1.2 items/s: speed is set from the length when the arm is placed.
  arm: { id: 'arm', name: 'Arm', minReach: 0, maxReach: 3, speed: 0, spacing: 0 },
  // 2 items/s.
  conveyor: { id: 'conveyor', name: 'Conveyor', minReach: 3, maxReach: 60, speed: 1.0, spacing: 0.5 },
};

export const LINK = {
  /** Sockets sit this high above a building's base, and about this far apart along a face. */
  socketHeight: 1.1,
  socketSpacing: 2.5,
  /** A link leaves its socket straight out for this far before turning. */
  stub: 1.0,
  /** Arms move this many items per second. */
  armRate: 1.2,
  /** Conveyors: the belt runs at least this high above the ground beneath it. */
  clearance: 3.2,
  /** A conveyor crossing another goes at least this much higher. */
  tierStep: 0.9,
  /** Ramps up from and down to a socket: rise per metre of run. */
  rampSlope: 0.6,
  /** Most a belt goes unsupported, metres (the buildings hold the ends). */
  span: 8,
  /** A support may move this far along the route to find free ground. */
  supportSlide: 2.5,
  /** Support post radius (solid to haulers), metres. */
  supportRadius: 0.2,
  /** Supports keep this far from buildings' footprints and docks, metres. */
  supportMargin: 0.6,
  /** Routes keep this far from other buildings, metres (horizontal). */
  routeMargin: 0.4,
};
