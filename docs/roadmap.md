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
**Status:** done

Content data for the starter set. Model kit and first-pass meshes for hub,
extractor, smelter, fabricator. Placement tool with ghost, free rotation, soft
snapping and validation. Recipes run against buffers; buffer stacks visible;
status language on buildings. Selection panel. Time controls.

Done when: you can place an extractor on a deposit and watch its output tray
fill and block. Buffers can be filled by a debug action so a smelter can be
seen working.

## M2 — Haulers
**Status:** done, awaiting design review (screenshots: `npm run shots -- m2-overview m2-factory m2-close m2-hub m2-starved`)

Nav grid, pathfinding with smoothing, hauler movement with cargo, the
dispatcher with reservations, hub storage, the dock-reachability rule.

Done when: extractor → smelter → fabricator → hub runs with haulers only,
with nothing connected by hand. Starving and blocking are visible when the
fleet is too small. Headless scenario test passes with no leaked reservations.

**Design review after M2**: screenshots and a short play. This is the first
point where the core loop can be judged, so expect tuning and visual notes.

## M2.5 — Review pass
**Status:** in progress (see Progress below)

Outcome of the design review of M2. The loop works and the structure is
sound; this pass is about the picture and one dispatch rule. The style guide
was updated at the same time (lighting targets, "design for the view from
above", roofs, ground paint, terrain, hauler shape and eyes): re-read
`visual-style.md` in full first.

1. **Light and exposure.** The scene is dim and olive: hull reads grey,
   graphite clips to black, shadows are long and heavy. Hit the targets under
   "Rendering rules".
2. **Haulers.** Too small and too dark to follow. Rework per the style guide:
   bigger, white-and-orange from above, raked visor, and the eyes (shape,
   gaze, blink; at least driving, dozing, job-assigned and stuck).
3. **Buildings.** Roofs are blank grey planes and plinths are black slabs.
   Thin the plinths, give every roof its signature part and some form, drop
   the orange band (orange on tray lips and dock edge only), light the hub
   bays, enlarge the hub's roof bins.
4. **Ground paint.** Aprons and parking are the loudest thing on screen.
   Thin, off-white, small yellow chevrons only; shrink the hub apron.
5. **Cliffs.** Still read as dark smears. Make them faces.
6. **Hub tidying.** Adopt the rule now in `design.md` (take from a producer
   only when its tray is full or nothing consumes the item). Report how the
   M2 chain's trip mix and parts-per-10-minutes change.

**Progress:** the look has been redone by the design lead directly in
`src/render/` (see `visual-style.md`, rewritten): weathered industrial kit,
rover haulers with static eyes, all four buildings, lighting, vegetated
ground, rocky deposits, trees and boulders (solid in the sim, cleared by
building), particle smoke, a `showroom` scenario and `show-*` screenshots.
Still open: eye expressions (2), ambient occlusion. Done by the implementer
with M3: nav radius, dock lanes and parking spacing for the larger hauler (2),
and hub tidying (6, trip mix reported in `notes.md`).

Answers to the other M2 questions: keep six starting haulers and do not tune
pressure until roads exist (M3 changes the numbers); pivot-and-reverse
parking is fine, no three-point turn; roof bins are the right way to show
hub stock.

Done when: the five M2 screenshots are regenerated and, at `m2-factory` zoom,
you can tell at a glance which way each hauler faces and what it carries;
nothing in frame is pure black or louder than the buildings; tests pass.

## M3 — The ground remembers
**Status:** done, awaiting design review (`npm run shots -- m3-roads m3-roads-close m3-traffic m3-fading m3-gap m3-gap-traffic`)

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
