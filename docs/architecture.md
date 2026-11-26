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

### Hauler movement and traffic (decided; replaces the first attempt)

Haulers are solid, wheeled vehicles: they cannot turn tighter than their
turning circle and cannot overlap each other or buildings. The first attempt
steered round other haulers by nudging the pursuit angle and capping speed,
then relied on timers (back off after 1 s, 3 s, 12 s; drive through after
24 s) when that failed. It fails often: see `npm run encounters`. The
structural reasons, which the replacement must remove rather than patch:

- A steering nudge fights path-following, which pulls straight back to the
  line. They settle at a sideways offset smaller than a hauler is wide, so a
  hauler standing on the path is never passed, even on open ground.
- Both parties to a meeting are slowed to a stop by the same rule, so nobody
  goes first.
- Conflicts are judged with 0.8 m discs and a 1.5 m "lane", against a body
  1.2 m wide, so haulers that would pass cleanly are treated as blocked.
- Standing haulers (loading, queueing, parked) are invisible to route
  planning, and routes run straight across other buildings' docks, which is
  exactly where haulers stand and reverse.

The replacement has three layers, each doing one job:

1. **Plan round what is standing.** A hauler that will stand for a second or
   more (loading, unloading, queued, parked) is an obstacle to route planning,
   stamped as a disc into a per-tick overlay on the nav grid. A moving hauler
   that sees one on its path ahead replans at once (rate-limited), instead of
   driving up to it. Other buildings' dock aprons carry a path cost, like the
   hub's parking rows, so through-traffic keeps off them. Queueing haulers
   wait at a holding point beside the apron, not in the approach.

2. **Choose a driveable arc, every tick.** Replace the steering nudge, the
   speed caps, the wall probes and the step-refusal with one mechanism. From
   the current pose, consider a fan of curvatures within the turning circle
   (about eleven) at a few speeds. Roll each forward for the distance needed
   to stop plus a margin, sweeping the hauler's real outline (1.8 × 1.2 m plus
   a small margin). Discard any that touches something solid or another
   hauler's predicted outline (others move at constant speed along their
   heading, or stand). Of the rest, take the one that ends nearest the
   pursuit point further along the path, with a small preference for holding
   the current curvature and, when someone is oncoming, for the right-hand
   side. If no forward arc is free, stop; if still stopped after a moment,
   consider reverse arcs the same way. Shunting is then just "the best arc
   happens to be a reverse one", not a separate state with its own timers.
   Turning on the spot remains only for a hauler boxed in on all sides.

3. **Decide who goes first.** In any pair, one has priority: the one already
   in a narrow place, else the loaded one, else the lower id. The other
   treats the first's predicted path as solid with a wider margin; the first
   ignores the other except for actual contact. Exactly one of them yields.

Driving through another hauler (the squeeze) stays as the last resort but
should be vanishingly rare, and is counted. Single-lane gaps where two cannot
pass are the job of signals later; until then priority plus backing out along
the path just driven is enough.

Acceptance, all measured by scripts in the repo:

- `npm run encounters`: every case arrives, none squeezes, none takes more
  than 1.5× the time of driving alone (three against three: 2×).
- `npm run traffic` on the M2 chain with six haulers: stopped under 5% of
  road time, shunting under 8%, no stall over 10 s, and no fewer parts than
  with haulers that could pass through each other (about 75 in 10 minutes).
- Twelve haulers make at least as many parts as six.

Secondary, same piece of code: routes are planned for a point and followed by
a vehicle. Plan with clearance for the body (about 1 m from footprints), and
round each corner of the smoothed path to the turning radius, so the path
itself can be driven without cutting corners into walls.

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
