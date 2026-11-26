# Implementation notes

Kept by the implementer. Newest first within each section. Keep entries to a
line or two.

## Calls made

Decisions taken where the docs were silent, departures from anything marked
*suggested*, and tunables changed from the design doc's starting values.

- **Eye expressions**, the set Emily asked for (`src/render/expressions.ts`, numbers in `FACE`):
  - neutral `▮ ▮` while driving, with a short blink every 3–6 s per hauler;
  - excited `^ ^` for 1.2 s when a parked hauler gets a job;
  - sleepy: half-open eyes (the lower half of the open eye, the lid edge a downward-dipping arc of twice the eye's bottom radius), dimmed, once parked for 1.5 s;
  - frustrated `> <` once a hauler on the road has made less than 0.75 m of headway in 1.5 s (jam or queue), or while squeezing past others; held 0.4 s so it doesn't flicker. On the quiet M2 chain that is about 7% of hauler time, nearly all of it queueing at the single-lane extractor docks.

  The style guide's other expressions (look into turns, look at the tray, squint on delivery, glance at a bot giving way, dim amber when a destination is unreachable) are not done. A scenario called `faces` lines up one of each for screenshots (`npm run shots -- faces`). (M2.5)
- **Scenario menu and controls card** in the top-left panel (H toggles the card). A host page can set `window.__FACTORY__ = { scenario, edgeScroll }` before loading the bundle, since an embedded page has no query string; the playable page uses that, with edge-scroll off. (M3)
- **Wear** (`src/sim/ground.ts`, numbers in `WEAR`): a passing hauler adds wear equal to the distance driven, spread over about 2.5 m across. Track at 10 (back to grass below 5), road at 34 (back to track below 20), capped at 60. Half-lives 150 / 210 / 300 s for grass / track / road. On the M2 chain, tracks show within a minute and road within 2–3 minutes; after the buildings go, road drops to track in about 9 minutes and is grass again after about 16. (M3)
- **Ground state is saved**: wear, level and crowd are typed arrays in `WorldState.ground`, serialised as base64. Save version is now 3. (M3)
- **Path cost per metre** = 1 / road speed (1, 1.25, 1.6) + 3 × crowd above comfortable + slope term. The A* heuristic is scaled by 1/1.6 so it stays admissible; string-pulling uses the same costs, so smoothing doesn't pull a path off a road. (M3)
- **Crowd field**: every 10 ticks, each non-parked hauler adds to its 3 × 3 cells, with exponential smoothing (time constant 6 s). Above 0.7, speed is divided by 1 + 0.5 × the excess. (M3)
- **Local avoidance** (`AVOID`): haulers are 0.8 m discs. A hauler follows the one ahead at its speed with a 0.6 m gap. Bots bound for the same dock spot queue, nearest first. Oncoming bots both steer right, crossing bots give way to the one on the right, and a stopped bot is steered round. Dodging never moves a bot into a blocked cell. Overlapping bots are nudged apart. (M3)
- **Deadlock breaker**: a hauler that makes no progress for 4 s squeezes past moving or held-up bots for 2.5 s, but still waits for bots that are loading and keeps its place in a dock queue. In the worst stress run (36 haulers on the M2 chain, 30 minutes) no hauler with a job went more than about 12 s without moving. (M3)
- **Hub tidying rule from the M2 review** adopted. Items that nothing consumes are taken once 4 are waiting, so end products travel in full loads. On the M2 chain over 10 minutes, with roads: 223 trips and 77 parts (extractor → hub 32, hub → smelter 20), against 229 trips and 74 parts under the old rule (45 and 25). (M2.5)
- **Sized for the bigger rover**: nav clearance 0.6 → 0.8 m. Dock lanes are 1.8 m apart (one lane on extractor and smelter docks would not fit two), and each hauler takes the lane fewest others are heading for. Parking is seven bays at 1.7 m in front, five down each side, then overflow rows behind the hub. Through-traffic pays +3 per metre to cross the parking rows, which stopped paths running between parked rovers. (M2.5)
- **Traffic overlay** (T): ground turns flat grey; tracks and roads darken; crowding goes hazard yellow, then fault red. Each hauler's remaining route is drawn as an orange line. (M3)
- **Road look**: tracks are bare dirt; roads are packed dark gravel (palette `road`) with a ragged, grown edge and faint ruts; no painted edge marks. (M3)
- **New debug command** `debugStock` (adds to hub stock), used by the `m3-gap` scenario. (M3)
- **Dispatcher rules** (`src/sim/haul.ts`, numbers in `DISPATCH`): a consumer asks once it is 4 or more short of full, or immediately if it can't start a craft. Producer outputs are offered first; the hub's stock only if no producer has enough. Offers smaller than a full load are used only for a consumer that is starving. (Hub tidying superseded in M2.5, above.) (M2)
- **Trip estimate is straight-line**; exact paths are computed only on assignment, and synchronously (no per-tick path budget yet). Measured about 0.2 ms per tick with 100 haulers and 56 buildings, so the queue can wait until a profile asks for it. (M2)
- **Path smoothing**: greedy forward string-pulling with 0.35 m side clearance, and a shortcut is refused if it costs more than 5% over the cell path (so it won't cut over a hill the A* went round). Footprints are inflated by 0.6 m on the nav grid. (M2)
- **Dock reachability rule**: a placement is refused if any dock, its own included, would no longer connect to the hub's dock. Checked with a flood fill of the hypothetical grid, about 1–2 ms, on every ghost move. Reasons read e.g. "Cuts off the smelter from the hub." (M2)
- **Docks have lanes**: haulers stop at one of several spots across a dock (five at the hub). Haulers drive to a point out from their bay, turn, and reverse in. (M2; spacing revised in M2.5)
- **Placing a building re-routes haulers** whose remaining path it blocks. A hauler caught inside a new footprint drives out from the nearest free cell. (M2)
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

- **Is the road too loud?** Packed gravel in the palette's `road` grey is the darkest large area on screen once a route is busy (see `m3-roads`). A lighter, browner road would sit back more. (M3)
- **How fast should roads fade?** Currently about 9 minutes from road to track, and about 16 to grass, after a route is abandoned. Faster would make rerouting feel more responsive; slower makes the ground feel more historical. (M3)
- **Jams resolve by squeezing**: after 4 s stuck, rovers drive through each other for a moment. It reads as a jam and never locks up, but the overlap is visible. A proper fix is lanes and signals, later. Acceptable for "soft first"? (M3)
- **Roads pay off**: the six-hauler M2 chain now makes about 77 parts in 10 minutes (65 before roads), and about 250 in 30 minutes, because routes speed up as they pave. (M3)
- **Signal colours in the overlay**: crowding uses hazard yellow and fault red, and routes use logistics orange. That is an overlay, not paint, but it is still a use of the signal colours. (M3)
- *M2 questions (tidying, pressure, parking manoeuvre, roof bins) were answered in the roadmap's M2.5 section.*
- Should production buildings carry the orange logistics stripe, or something neutral? Provisional: orange band. (M1)
- Hub storage is shown as six open bins on the hub's roof, one per item, up to 12 items visible each. Is that the right way to make the hub's stock legible? (M1)

## Known rough edges

Things that work but are not good yet.

- In heavy jams, rovers squeeze through each other after 4 s (see the questions above). (M3)
- Haulers queueing at a busy dock for more than 1.5 s also look frustrated; it is the same "held up by others" signal as a jam. (M2.5)
- Bots steering round each other can still clip the corner of a building's clearance zone (not the building itself). (M3)
- No way to select a hauler or see its job; the info bar only counts busy haulers. (M2)
- Smoke puffs are plain grey spheres. (M2)
- Cliff faces are rendered from the 1 m heightfield and show some stair-stepping in colour along their edges. (M0)
- Each building is a separate group of a few meshes; fine at this scale, will want merging or instancing nearer 200 buildings. (M1)
