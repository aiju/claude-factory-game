# Implementation notes

Kept by the implementer. Newest first within each section. Keep entries to a
line or two.

## Calls made

Decisions taken where the docs were silent, departures from anything marked
*suggested*, and tunables changed from the design doc's starting values.

- **Dispatcher rules** (`src/sim/haul.ts`, numbers in `DISPATCH`): a consumer asks once it is 4 or more short of full, or immediately if it can't start a craft. Producer outputs are offered first; the hub's stock only if no producer has enough. Offers smaller than a full load are used only for a consumer that is starving. Outputs are tidied into the hub once 4 are waiting or the tray is full. (M2)
- **Trip estimate is straight-line**; exact paths are computed only on assignment, and synchronously (no per-tick path budget yet). Measured about 0.2 ms per tick with 100 haulers and 56 buildings, so the queue can wait until a profile asks for it. (M2)
- **Path smoothing**: greedy forward string-pulling with 0.35 m side clearance, and a shortcut is refused if it costs more than 5% over the cell path (so it won't cut over a hill the A* went round). Footprints are inflated by 0.6 m on the nav grid. (M2)
- **Dock reachability rule**: a placement is refused if any dock, its own included, would no longer connect to the hub's dock. Checked with a flood fill of the hypothetical grid, about 1–2 ms, on every ghost move. Reasons read e.g. "Cuts off the smelter from the hub." (M2)
- **Docks have lanes**: a hauler stops at one of up to three spots across a dock (five at the hub), picked by its id, so a few can load side by side. (M2)
- **Parking**: eight bays in a painted row in front of the hub, then five down each side. Haulers drive to a point 2.4 m out, turn, and reverse in. (M2)
- **Placing a building re-routes haulers** whose remaining path it blocks. A hauler caught inside a new footprint drives out from the nearest free cell. (M2)
- **Haulers are drawn at 1.3×** their nominal 1.2 m, per "deliberately a little large". Visual only. (M2)
- **Plateau cliffs widened** to 4.5–6 m horizontal, so cliff faces catch light and read as rock rather than black gashes. Still impassable (slope above 0.6). (M2)
- **Accent stripe on production buildings is logistics orange**, placed as a band around the hull. Read as "this is where goods come and go". (M1)
- **Furnace mouth glow is a warm `#FFA860`**, added to the palette as light rather than paint, so it is not an accent colour. (M1)
- **Lamp is off when working or idle**; amber blinking (starved) and amber steady (blocked) as per the status table. The ok-green is used only in the UI panel. (M1)
- **Recipe change**: inbound hauler jobs are cancelled (same path as demolish); inputs that no longer apply, and the inputs of an interrupted craft, move to the output buffer as leftovers on offer, so nothing is lost. (M1)
- **Extractor placement**: its centre must lie on a deposit. (M1)
- **Buffer sizes** (in `src/data/buildings.ts`): inputs hold 4 crafts' worth of each ingredient; outputs hold 8 (extractor) or 6. (M1)
- **Commands from the UI apply immediately at the tick boundary** (so building works while paused), and are logged with their tick. `submit()` queues for the next tick instead; tests use either. (M1)
- **Snapping**: to the nearest neighbour's rotation (or a quarter turn of it) within 12°, then to its edges, centre line, or just clear of its dock, within 0.8 m; otherwise rotation snaps to 15°. Shift disables. Arm's-reach-of-socket snapping waits for sockets (M4). (M1)
- **Generator and pylon are in the data but not in the build bar** until M5. (M1)
- **Map coordinates run 0..256** on X and Z rather than being centred, which keeps grid maths simple. (M0)
- **Map**: hand-placed deposits and three plateaus, each with cliffs on most sides and one ramp; gentle value-noise ground, flattened around the hub and settling to a base level at the map edge, where a flat skirt continues to the fog. (M0)
- **Screenshot script uses the globally installed Playwright**, not a project dependency. (M0)

## Questions for design review

Taste-heavy or foundational questions. State the provisional choice you went
with so work is not blocked.

- **Tidying to the hub generates a lot of round trips.** In the M2 chain over 10 minutes, about 40% of ore trips are extractor → hub, and a quarter of the smelters' ore later comes back out of the hub. It does make the hub fill up visibly, and the fleet feels busy. The alternative is to tidy only when an output is full (blocked), leaving stock at producers for direct pickup. Provisional: tidy at 4 waiting. (M2)
- **Pressure arrives fast**: six haulers saturate the M2 chain (two extractors, two smelters, one fabricator) within about two minutes; it makes about 65 parts in 10 minutes against the fabricator's 100. That matches the design's intent; flagging it as the first tuning knob. (M2)
- Haulers pivot almost in place at the approach point before reversing into a bay. A proper three-point turn would be more charming; worth it? (M2)
- Should production buildings carry the orange logistics stripe, or something neutral? Provisional: orange band. (M1)
- Hub storage is shown as six open bins on the hub's roof, one per item, up to 12 items visible each. Is that the right way to make the hub's stock legible? (M1)

## Known rough edges

Things that work but are not good yet.

- No local avoidance yet: haulers overlap at docks and pass through each other (M3). (M2)
- No way to select a hauler or see its job; the info bar only counts busy haulers. (M2)
- Smoke puffs are plain grey spheres. (M2)
- Cliff faces are rendered from the 1 m heightfield and show some stair-stepping in colour along their edges. (M0)
- Each building is a separate group of a few meshes; fine at this scale, will want merging or instancing nearer 200 buildings. (M1)
