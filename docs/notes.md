# Implementation notes

Kept by the implementer. Newest first within each section. Keep entries to a
line or two.

## Calls made

Decisions taken where the docs were silent, departures from anything marked
*suggested*, and tunables changed from the design doc's starting values.

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

- Should production buildings carry the orange logistics stripe, or something neutral? Provisional: orange band. (M1)
- Hub storage is shown as six open bins on the hub's roof, one per item, up to 12 items visible each. Is that the right way to make the hub's stock legible? (M1)

## Known rough edges

Things that work but are not good yet.

- Cliff faces are rendered from the 1 m heightfield and show some stair-stepping in colour along their edges. (M0)
- Each building is a separate group of a few meshes; fine at this scale, will want merging or instancing nearer 200 buildings. (M1)
