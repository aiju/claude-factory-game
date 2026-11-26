# Game design

## Pitch

An industrial sci-fi factory game with god-view controls. You place buildings
freely on a fixed map. A finite fleet of small hauler bots carries everything
between them without being told to. Their traffic wears paths into the ground,
paths become roads, roads jam — and the jam tells you which flow deserves real
infrastructure. You then harden that flow with a conveyor, an arm, a ropeway,
and the bots you freed go and do something else.

It starts like a settler game and grows into a conveyor game.

## Pillars

1. **Nothing is ever disconnected.** Two buildings that could trade, do. There
   is no "it doesn't work because I forgot to connect it" state. Infrastructure
   is an optimisation, never a prerequisite.
2. **Harden what's busy.** The player responds to pressure they can see. Every
   transport mode has a niche; none makes the others pointless.
3. **Legible by looking.** A problem shows up in the world — a pile, a queue,
   a dark window, a blinking lamp — before it shows up in a panel.
4. **Gridless and forgiving.** Free position and rotation, soft snapping,
   links drawn in one drag. Nothing is laid tile by tile.
5. **Serious, with manners.** See `visual-style.md`.

Out of scope for now: combat, terraforming, map generation, story, a win state.
The eventual forward pull is *development* (unlocking tiers by delivering
goods); until then it is a sandbox for exploring the systems.

## The world

- One fixed map, about 256 × 256 m, defined in code from a fixed seed.
- Terrain is a heightfield: mostly gentle, with a few cliffs and plateaus.
  Elevation is scenery and a mild constraint (bots slow on slopes, cliffs
  block them, buildings need roughly flat ground). It is not the core puzzle.
- Deposits of **ore**, **rock** and **coal** are scattered so that no single
  spot has everything.

## Buildings

Placed with free position and rotation. Each has:

- **Footprint** — an oriented rectangle (or a few). Buildings may touch.
- **Dock** — one small apron at the front where haulers load and unload.
  Invariant: every dock stays reachable from the hub. A placement that would
  break this is refused, with the reason shown on the ghost.
- **Sockets** — neutral attach points around the other sides. A socket becomes
  an input or an output when a link is attached to it.
- **Buffers** — a small input buffer per ingredient and output buffer per
  product. Their contents are visible as stacks on the building's trays.
- **State** — working, starved (missing input), blocked (output full),
  unpowered, or idle. State is always shown on the building itself.

Placement snaps softly: to the alignment and rotation of nearby buildings, to
15° steps, and to arm's reach of a neighbour's socket. Holding a modifier
disables snapping.

### Starter set

| Building | Does | Notes |
|---|---|---|
| Hub | Stores everything, houses haulers, supplies a little power | One, pre-placed |
| Extractor | Deposit → 1 raw item / 2 s | Must overlap a deposit |
| Smelter | 2 ore → 1 plate, 4 s | |
| Fabricator | 2 plate → 1 part, 6 s **or** 1 plate + 2 rock → 1 frame, 6 s | Recipe chosen per building |
| Generator | Burns 1 coal / 10 s → 20 power | |
| Pylon | Extends the power network | |
| Depot | Houses more haulers, small storage | Later |
| Junction | Tiny pass-through building: splits and merges links | Later |

Six items: ore, rock, coal (raw); plate, part, frame (made). Enough for a
two-input recipe, a fuel loop and a recipe choice; no more until the systems
are fun.

## Logistics

### Requests and offers

Everything that moves does so because of a request:

- An input buffer below its target level **requests** the shortfall.
- Anything in an output buffer is **on offer**.
- The hub **offers** whatever it stores, at the lowest priority: a consumer
  is fed from a producer when one has stock.
- The hub **takes** an item from a producer only when that producer's output
  tray is full, or when nothing on the map consumes that item. So end
  products flow steadily to the hub, intermediates wait at their producer for
  direct pickup, and the hub only absorbs genuine surplus.
- Later, a construction site is just a building that requests its own cost.

### Haulers

Small ground bots. Finite: the hub starts with a handful, and more are built
from parts (a debug button until construction costs exist). Starting stats:
4 m/s, carries up to 4 of one item, a short pause to load and unload. Idle
haulers return to their home hub or depot and park.

A dispatcher matches requests to offers and idle haulers:

- Order requests by priority class (consumers and construction above hub
  storage), then by how empty the buffer is, then by age.
- For each, pick the offer and hauler with the shortest estimated trip.
- Reserve the items and the destination space so nothing is double-booked.
- A hauler heading home is fair game for a new job.

Rough calibration: one hauler on a 40 m route moves about 0.2 items/s; one
extractor makes 0.5/s. With six haulers, pressure arrives within minutes. That
is intended.

### Wear, roads, congestion

- Ground remembers traffic. Each pass adds **wear**; wear decays slowly.
- Wear crosses thresholds (with hysteresis) to become a **track**, then a
  **road**. Tracks and roads are faster (about ×1.25 and ×1.6), and
  pathfinding prefers them, so routes consolidate like ant trails.
- Abandoned roads fade. Roads never block building; they are a property of the
  ground, not an object.
- Congestion is soft at first: bots keep their distance, slow down in a crowd,
  and route around persistent jams when a reasonable alternative exists. Gaps
  between buildings become natural pinch points, so leaving avenues matters.
- Later: a road graph extracted from the wear field, lanes, and automatically
  placed signals where a road narrows to one lane. Carts and rails get level
  crossings.

### Links

A link carries items from one building's output buffer to another's input
buffer. The player picks a link tool and drags from source building to
destination building; the game chooses sockets, routes the link, and sets the
filter to "whatever the source makes that the destination uses". One output
can feed several links (round-robin); one input can take several.

An ingredient that arrives by link no longer requests haulers. If the link
under-delivers, the building visibly starves — the player took that flow on.
Output buffers stay on offer to haulers; links just get first pick.

All link types are parameterisations of two mechanisms:

| Mechanism | Types | Model |
|---|---|---|
| Continuous | arm, conveyor, chute, pipe | A queue of items moving along a path |
| Batch | ropeway, cart, train | Vehicles shuttling between two terminals |

| Type | Reach | Throughput | Niche |
|---|---|---|---|
| Hauler (not a link) | anywhere | ~0.2/s each, worse with distance | Default; zero setup |
| Arm | ≤ 3 m | ~1.2/s | Rewards packing buildings together; cheap |
| Conveyor | 3–60 m | ~2/s | Mid-range workhorse |
| Chute | ≤ 30 m, downhill only | ~3/s | Free to run where terrain allows |
| Ropeway | 30–250 m | bursty, ~1/s | Long hauls; ignores what is beneath it |
| Pipe | 3–80 m | fluids | Later, with fluids |
| Cart / train | long | very high, bursty | Later; ground track with crossings |

**Conveyors run overhead.** They leave a socket, rise to about 3 m on slim
pylons, and descend at the far end. Bots drive underneath. Where conveyors
cross, the newer one takes the next height tier up. Pylons are placed
automatically; the player may add waypoints to bend a route. This keeps the
ground for traffic and buildings, and removes belt-crossing puzzles on purpose:
the interesting decisions are which mode to use and how to balance rates.

First link types to build: conveyor and arm. Then ropeway. The rest later.

## Power

- Generators supply, most buildings and links demand. The hub supplies a
  small free amount so the first few buildings work.
- **Wiring is automatic.** Anything within about 12 m of a powered building or
  pylon joins that network; cables are drawn for you. Pylons bridge gaps
  (about 30 m pylon to pylon). A compact factory is one network without effort.
- If demand exceeds supply, everything on that network slows in proportion
  (brownout) rather than cutting out. Lights dim.
- Later: storage, other generator types, haulers that charge at depots.

## Controls

RTS conventions throughout.

- Camera: pan with WASD, edge-scroll or middle-drag; zoom with the wheel
  (towards the cursor); rotate with Q/E or right-drag. Pitch is limited.
- Left-click selects; a panel shows the building's recipe, buffers and state.
- A build bar along the bottom with hotkeys. Placement shows a ghost; R or
  right-drag rotates; Esc cancels.
- Link tool: drag building to building. Demolish tool.
- Time: pause, ×1, ×2, ×4.
- Overlays: logistics (who is asking whom for what), traffic, power.

## Later, in rough order

Construction costs delivered by haulers · building haulers from parts ·
depots · junctions · ropeways · road graph and signals · fluids and pipes ·
carts and trains · development tiers · save and load UI.
