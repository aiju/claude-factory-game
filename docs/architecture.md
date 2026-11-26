# Architecture

Items marked **decided** are settled. Items marked *suggested* are a starting
point the implementer may change, with a line in `notes.md`.

## Stack

TypeScript (strict), Vite, three.js, Vitest. UI is plain DOM and CSS over the
canvas, no framework until it hurts. No asset pipeline: geometry is built in
code.

## Hard rules (decided)

1. **Sim and view are separate.** `src/sim/` is pure logic: no three.js, no
   DOM, no wall-clock time, no `Math.random`. It runs headless in tests.
2. **The sim changes only through commands** (place building, create link,
   demolish, set recipe, …). Tools build commands; the sim validates and
   applies them. This is what makes tests, saves and replays cheap.
3. **Fixed tick.** 30 ticks per second, fixed `dt`. The renderer interpolates
   between ticks. Game speed runs more ticks per frame.
4. **Reproducible.** Same commands on the same ticks give the same state on
   the same machine: seeded RNG, stable iteration order. Cross-machine
   bit-exactness is not a goal.
5. **State is plain data** that serialises to versioned JSON. No class
   instances with hidden state, no references into the renderer.
6. **Content is data.** Items, recipes, buildings, link types and tunables
   live in `src/data/`. Adding a recipe should not touch sim code.
7. **The renderer only reads.** It never mutates sim state.

## Layout (suggested)

```
src/
  data/      items, recipes, buildings, link types, tunables, the map
  sim/       world state, tick, commands
    terrain  heightfield, deposits
    build    footprints, placement validation, spatial index
    prod     recipes, buffers, building state
    nav      nav grid, pathfinding, wear and roads, congestion
    haul     haulers, dispatcher
    links    continuous and batch links
    power    networks, brownout
  render/    scene, camera rig, terrain, model kit, instanced items and bots
  input/     camera controls, picking, tools (place, link, demolish, select)
  ui/        build bar, selection panel, overlays, time controls
  main.ts    wiring and the frame loop
tests/       headless scenarios
```

## Space

- Metres, Y up, ground on XZ. Map 256 × 256 m.
- Terrain: heightfield sampled at 1 m, bilinear interpolation.
- Buildings: continuous position and rotation; footprints are oriented
  rectangles; overlap tested exactly (OBB), found via a spatial hash.

## Chosen approaches

### Navigation (decided: hidden grid)

The world feels gridless; navigation is not. A **1 m nav grid** underlies
everything bots do. It was chosen over a navmesh because obstacles change
constantly, and because wear, roads and congestion all want a per-cell field
anyway.

- Cells are blocked by building footprints (inflated by the bot radius),
  pylons and cliffs. Re-rasterise locally when something is placed or removed.
- Path cost per cell = distance ÷ road speed multiplier, plus a slope penalty,
  plus a congestion penalty. 8-connected, no corner cutting.
- *Suggested:* A* per trip with a per-tick budget and a request queue; smooth
  the result (string-pulling) so bots travel in straight lines and arcs, not
  staircases. If many bots share destinations, per-dock flow fields are a
  reasonable optimisation later.
- Bots move in continuous space along the smoothed path with simple local
  avoidance. They must never visibly snap to cells.

### Wear and roads (decided)

- A float `wear` per nav cell. A bot adds wear to the cells it crosses; all
  wear decays exponentially (half-life of a few minutes, slower once paved).
- Road level per cell from thresholds with hysteresis: none, track, road.
  Level sets the speed multiplier used by both movement and path cost.
- Rendering reads the wear field as a texture and blends the ground material,
  so roads look organic and cost nothing in geometry.
- The later road graph (lanes, signals) will be derived from this field; do
  not design it yet, but keep the field accessible.

### Congestion (decided: soft first)

- Track bot density per cell (smoothed over time). Speed falls off above a
  comfortable density; path cost rises with it.
- Local avoidance keeps bots from overlapping. Head-on bots should resolve by
  each keeping to one side.

### Dispatch (decided)

As described in `design.md`: a periodic pass (*suggested:* every 10 ticks)
that sorts requests, greedily assigns the cheapest offer-and-hauler pair using
a distance estimate, and reserves both ends. Exact paths are computed only on
assignment. Reservations must be released on every failure path (building
demolished, path not found).

### Links

- **Continuous** (decided): a link is a 1D queue over a path of known length.
  Items have a position along it, a speed and a minimum spacing. It pulls from
  the source buffer when its entry is clear and pushes into the destination
  when the head arrives and there is room; otherwise it backs up. An arm is
  the same thing with near-zero length and a cycle time. *Suggested:* store
  gaps between items so a moving belt is O(1) per tick.
- **Batch**: vehicles on a line between two terminals with load and unload
  dwell. Design it when we get there.
- **Routing** is geometry, done at creation: path from socket to socket via
  optional waypoints, height tier chosen to clear what it crosses, pylons at
  regular spacing where the ground is free. The sim stores the result; it does
  not re-route.

### Power (decided)

Union-find over a proximity graph (building-to-building and pylon ranges),
rebuilt when things are placed or removed. Per network: satisfaction =
min(1, supply ÷ demand), applied as a speed factor to consumers.

## Rendering notes

- Instanced meshes for anything numerous: items, haulers, pylons, conveyor
  segments.
- A small **model kit** in `render/`: helpers for bevelled boxes, cylinders
  and so on, taking palette roles rather than raw colours. Building meshes are
  composed from it, following `visual-style.md`.
- Palette lives in one module. No colour literals elsewhere.

## Targets

Smooth at 60 fps on a mid-range laptop with about 200 buildings, 500 haulers
and 5,000 items on links. Not a constraint to optimise for early; a reason to
avoid per-entity objects and per-item meshes from the start.

## Testing and review

- Headless scenario tests for every sim feature: issue commands, run N ticks,
  assert on state. Example: extractor + smelter + hub, 3,000 ticks, plates in
  the hub, no leaked reservations.
- A screenshot script (fixed camera positions, headless browser) is very
  welcome: visual review by the design lead happens from screenshots.
