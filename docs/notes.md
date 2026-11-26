# Implementation notes

Kept by the implementer. Newest first within each section. Keep entries to a
line or two.

## Calls made

Decisions taken where the docs were silent, departures from anything marked
*suggested*, and tunables changed from the design doc's starting values.

- **Traffic rewrite to the architecture doc's three layers** (`src/sim/drive.ts`, numbers in `DRIVE`). The old avoidance, its back-off and patience timers, and `AVOID` are gone. (M3.5)
  - Layer 1: standing haulers are stamped as 1.6 m discs onto a per-tick overlay. Routes go round them, and string-pulling now respects the overlay too; before, it pulled routes straight back through. A moving hauler that sees one on its route ahead replans, at most once a second.
  - Layer 2: every tick, 11 curvatures, forward and back, each swept with the real 1.8 × 1.2 m outline. With someone to give way to, each arc is also judged at about a third of the speed, braking included, so it can slow and pass behind instead of swerving.
  - Layer 3: priority is narrow, then loaded, then lower id. Only same-way traffic (within about 25°) uses leader and follower, and which one leads is judged along their shared direction, so exactly one of a pair leads. The 45° crossing used to lock the two side by side. The one with right of way keeps clear of where the other is now, for as far as it takes to stop.
  - Haulers already touching may move apart or along, never further in. The old rule ignored each other once touching, which let them drive through.
  - Kerbside docks: a non-hub building has one lane. The hauler pulls up alongside it after a 4 m straight run-in, from whichever end costs least in distance plus turning, and the corner onto the run-in is rounded. Making every dock one-way was tried and was worse (30 parts against 36).
  - Leaving with the way behind: if there is room, the hauler pulls forward and loops round instead of a three-point turn. It loops the long way if the short side is a wall.
  - Parking is back to pivot-and-reverse, as approved at the M2 review: stop 2.6 m straight out from the bay (every other bay 4.3 m, so neighbours can turn at the same time), turn on the spot to face out, back straight in. The quarter-circle reverse kept circling.
  - Trees and rocks are padded by 0.7 m on the nav grid (was 0.3). Routes threaded 1 m gaps between a tree and a building, and haulers wedged in them. A hauler stuck 2 s may clip ground cells for 0.75 m to get out.
  - Loop guard: no headway along the path for 6 s means turn on the spot to face the way. A hauler that keeps missing the end of a leg replans after 5 s, and after 10 s within 2.2 m counts as arrived.
  - Results are in "Questions for design review". Encounters all pass and are now tests (`tests/encounters.test.ts`); throughput does not meet the target.
- **Haulers are solid** (Emily: "they drive through buildings and other haulers sometimes"). Back-off, patience and dock-queue rules below were replaced in M3.5:
  - Buildings, trees and cliffs: a hauler's centre never enters a footprint plus 0.6 m. A step that would is pushed back to the edge, so it slides along the wall.
  - Other haulers: a step that would bring two outlines (1.8 × 1.2 m) into contact is refused. Collisions are checked against where the other is and where it is heading this tick, and also when turning on the spot.
  - When stuck behind another hauler, it backs off: after 1 s if the other is standing still, after 3 s if both are moving and it is the higher-numbered one.
  - The guarantee against deadlock is headway along the path. With none for 12 s it backs right off and plans again, or turns on the spot if it was circling. After 24 s, and only if other haulers are what holds it, it squeezes past (drives through) for 2.5 s, and stays ghosted until clear. Waiting in a dock queue (within 9 m of the spot) doesn't count.
  - Results: no hauler inside a building, and no touching outside a squeeze, in either test scenario. Squeezes are about 2.5 per hauler per 10 minutes on the M2 chain (about 1% of hauler time), and about 4.5 in the 30-hauler gap jam. Worst wait: about 45 s.
  - Building docks have two lanes 1.8 m apart. While one is being worked, the next hauler for it waits 3 m back so the first can back out.
  - **Cost**: the six-hauler M2 chain now makes about 100 parts in 30 minutes, against about 180 when haulers could pass through each other. More haulers make it slower, not faster (12: about 97; 20: about 82), because the docks become the bottleneck. Road thresholds were lowered (track 8, road 26) so a busy route still paves within about 3 minutes at the lower traffic. (M2.5)
- **Heads turn** (`src/render/head.ts`, numbers in `HEAD`). The head is its own mesh on the neck, and eyes and visor turn with it.
  - It looks into bends before the body turns (up to 40°), and at the building when within 4 m of its dock or while loading.
  - It swivels 180° to face where it is going on a long reverse: at least 3 m of a parking leg left, or more than 2 s of reversing. It faces forward again once driving forward or parked. Never more than one turn round per 2 s.
  - On the busy M2 chain that is about one turn round per hauler every two minutes; short shunts don't trigger it. (M2.5)
- **Haulers drive like wheeled vehicles** (`drive()` in `src/sim/haul.ts`, numbers in `HAULER`), at Emily's request:
  - Heading changes only while moving, never tighter than a 1.8 m turning radius. Paths are followed by pure pursuit (lookahead 1.4 m plus 0.35 s of travel).
  - They slow for curves (4.5 m/s² sideways), and to 2 m/s through bends tighter than they can turn.
  - **Shunt**: when the way on is behind and inside the turning circle, or a turn would run into something, the hauler stops, backs up with opposite lock for up to 3 s, then drives on. This is how they back out of docks. With another hauler right behind, it swings round the long way instead.
  - **Pivot**: turning on the spot is the last resort, only when walled in ahead and behind. In the M2 chain that is about 0.5% of driving time.
  - A dock spot inside the turning circle counts as reached within 0.9 m.
  - **Parking**: run along in front of the row, stop 2.6 m out and 2.6 m to one side of the bay, then reverse in along a quarter circle. The heading squares up on arrival if within 20°.
  - Paths now keep the start as waypoint 0, and reversing legs are marked by index (`revFrom`). Save version is 4.
  - **Cost**: the six-hauler M2 chain makes about 51 parts in 10 minutes (77 before) and about 180 in 30 (about 250 before). Turning circles and three-point turns at docks take time. (M2.5)
- **Eye expressions**, the set Emily asked for (`src/render/expressions.ts`, numbers in `FACE`):
  - neutral `▮ ▮` while driving, with a short blink every 3–6 s per hauler;
  - excited `^ ^` for 1.2 s when a parked hauler gets a job;
  - sleepy `◡ ◡` (a ")" turned on its side, like closed lids), dimmed, once parked for 1.5 s;
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

- **M3.5 acceptance: movement passes, throughput doesn't.** The M2 chain is chaotic: the same run with initial headings nudged by a thousandth of a radian gives anywhere from 16 to 44 parts. So these numbers are means over 8 runs (4 for twelve haulers), not single runs.
  - `npm run encounters`: all 12 cases arrive with no squeezes, all within 1.5× of driving alone (three against three 1.8×, limit 2×). Met.
  - Six haulers on the M2 chain: 33 parts in 10 minutes (target about 50; 30 before M3.5); stopped 11% (target < 5%); shunting 13% (target < 8%); worst stall 12 s (target ≤ 10 s). Not met.
  - Twelve haulers make 32 parts against 33 for six: about level, where before it was fewer. Their worst stall is up to 71 s, in one run, around the hub.
  - Where the time goes: a lone hauler is at speed two thirds of the time and barely shunts. With six, the stops and shunts are near docks. About half are leaving one: kerbside docks put the hauler parallel to the building, the next destination is often behind it, and with others about there is rarely room to loop round. The four production docks of the M2 chain are within about 15 m of each other.
  - I think the remaining gap is mostly dock layout rather than driving rules. Candidates for a design call: docks with two lanes, or a drive-through lane with room to pull out; queueing at a holding point (architecture doc, layer 1; not done yet); or accepting that busy docks are what links (M4) are for.

- **Docks are now the bottleneck**, and adding haulers makes it worse. That is arguably the game working: a busy dock is what links are for (M4). But the cheapest improvement would be docking the way trucks do: reversing onto the dock, so they leave forwards without a three-point turn in front of the queue. (M2.5)
- **Docks and turning**: haulers arrive at a dock facing the building and mostly have to back out. Real yards have trucks reverse onto the dock instead, which would read well and save a shunt on the way out. Worth doing? (M2.5)
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

- In heavy jams, rovers still squeeze through each other after 10 s stopped with others about, for 2 s. It is rare on the M2 chain (under 0.5% of road time with six) but visible in the 30-hauler gap jam. (M3.5)
- Haulers queueing for a dock wait on the road behind the one working it, not at a holding point beside the apron. (M3.5)
- Haulers queueing at a busy dock for more than 1.5 s also look frustrated; it is the same "held up by others" signal as a jam. (M2.5)
- Bots steering round each other can still clip the corner of a building's clearance zone (not the building itself). (M3)
- No way to select a hauler or see its job; the info bar only counts busy haulers. (M2)
- Smoke puffs are plain grey spheres. (M2)
- Cliff faces are rendered from the 1 m heightfield and show some stair-stepping in colour along their edges. (M0)
- Each building is a separate group of a few meshes; fine at this scale, will want merging or instancing nearer 200 buildings. (M1)
