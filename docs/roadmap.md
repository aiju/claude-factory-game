# Roadmap

Each milestone ends with something you can look at or play. "Done when" is the
bar; how to get there is the implementer's call. Update **Status** as you go.

Until M6, building is free and instant, and a debug button adds haulers.

---

## M0 — A place to stand
**Status:** done

Toolchain, frame loop with fixed-tick sim, the fixed map's terrain with
deposits marked, RTS camera, lighting and fog per the style guide.

Done when: `npm run dev` shows the terrain; the camera pans, zooms and rotates
comfortably; a trivial sim test runs under `npm test`; `CLAUDE.md` lists the
commands. A screenshot script if practical.

## M1 — Buildings that work
**Status:** not started

Content data for the starter set. Model kit and first-pass meshes for hub,
extractor, smelter, fabricator. Placement tool with ghost, free rotation, soft
snapping and validation. Recipes run against buffers; buffer stacks visible;
status language on buildings. Selection panel. Time controls.

Done when: you can place an extractor on a deposit and watch its output tray
fill and block. Buffers can be filled by a debug action so a smelter can be
seen working.

## M2 — Haulers
**Status:** not started

Nav grid, pathfinding with smoothing, hauler movement with cargo, the
dispatcher with reservations, hub storage, the dock-reachability rule.

Done when: extractor → smelter → fabricator → hub runs with haulers only,
with nothing connected by hand. Starving and blocking are visible when the
fleet is too small. Headless scenario test passes with no leaked reservations.

**Design review after M2**: screenshots and a short play. This is the first
point where the core loop can be judged, so expect tuning and visual notes.

## M3 — The ground remembers
**Status:** not started

Wear field, tracks and roads with speed bonus and path preference, rendered as
ground blend. Soft congestion and local avoidance. Traffic overlay.

Done when: a busy route visibly becomes a road within a few minutes and fades
after its buildings are removed; a narrow gap between buildings visibly jams.

## M4 — Hardening
**Status:** not started

Link tool. Conveyors (overhead, auto-routed, auto-pylons, height tiers) and
arms. The link-fed rule. Logistics overlay.

Done when: replacing a jammed hauler route with a conveyor visibly frees
haulers and the road beneath it fades; two adjacent buildings can be joined by
an arm; conveyors can cross.

## M5 — Power
**Status:** not started

Generator, pylon, automatic wiring, networks, brownout, power overlay,
unpowered and brownout status on buildings.

Done when: a factory outgrows the hub's supply and visibly slows; adding a
coal-fed generator restores it; an out-of-range building shows as unpowered
until a pylon bridges the gap.

## M6 — An economy
**Status:** not started

Buildings and links cost items, delivered to construction sites by haulers.
Haulers are built from parts. Depots.

Done when: starting from the hub's initial stock, a factory can be grown
without any debug actions.

---

## After that (unordered, undesigned)

Junctions · ropeways · road graph, lanes and signals · fluids and pipes ·
carts, trains and crossings · development tiers · save and load UI · a second
map.
