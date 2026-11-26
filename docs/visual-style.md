# Visual style

## The idea

**Serious, worn industrial hardware in a cold, scrubby landscape — and small
robots with warm eyes working in it.** Think of a working mine or a frontier
plant in science fiction: steel frames, chipped paint, pipework, grime. The
machines are not cute. The haulers' eyes are the one soft, warm thing in the
frame, and they stand out because nothing else is.

- Hard edges, visible seams, exposed structure. No rounded, toy-like forms.
- Everything looks used: faded paint, streaks, dirt at the foot, dust on top,
  bare metal where edges have chipped.
- Detail earns its place by reading as real plant: ladders, railings, vents,
  tanks, ducts, flanges, bracing.
- **The bots are the characters; the factory is the set.** Only things that
  move around on their own get eyes. No mouths, no speech bubbles, no jokes.

## How it is built

No texture files and no asset pipeline. The look comes from three things in
`src/render/`:

- **`kit.ts`** — a kit of parts. Blocks have small chamfers; walls are clad in
  separate plates with dark seams and slight tone variation; pipes have
  flanges and ball joints; trusses are real members. Every vertex carries a
  paint colour plus *wear* (chamfers and rims) and *metal* (bare steel).
- **One weathering shader** shared by all kit geometry: uneven paint, streaks
  down walls, soot patches, dirt rising from the ground, dust settling on
  top, and paint chipping to bare metal along worn edges.
- **`palette.ts`** — every colour, by role. No colour literals elsewhere.

When adding a model, compose it from the kit and let the shader do the grime.
Do not hand-paint dirt into colours.

## Light

- A warm, lowish sun (about 40°) from the front-left of an unrotated
  building, so dock sides are lit in the default view. Shadows are long
  enough to model form.
- Ambient light comes from the sky itself (an environment map of the sky
  gradient), which also gives bare metal something to reflect, plus a small
  cool fill.
- Light haze in the horizon colour. No day/night cycle yet.
- Camera: narrow field of view (30°), pitch 35–65°. **Design for the view from
  above**: roofs and top surfaces are most of what the player sees, so the
  moving part, the trays and the lamp must be visible from there.

## Colour

Three families, kept apart so each reads at a glance:

| Family | Colours | Notes |
|---|---|---|
| Land | muted moss greens, dry ochre grass, brown dirt, grey rock, near-black spruce | Desaturated and mid-to-dark, so machinery stands out against it |
| Machinery | tired off-white paint, mid grey, dark steel, bare metal | Lighter than the land; never pure white or pure black |
| Signals | orange, cyan, yellow-and-black, warm white | Small, saturated, and strictly functional |

Signals mean one thing each, everywhere:

| Colour | Means |
|---|---|
| Orange | Logistics: where goods cross a boundary (tray lips, dock lintels), hauler markings |
| Cyan | Power: lit windows and indicator lights |
| Yellow and black | Something that moves or crushes; the dock edge of a pad |
| Amber lamp | Status: blinking when starved, steady when blocked |
| Furnace glow | Heat. It is light, not paint |
| Warm white | A hauler's eyes. Nothing else uses it |

Items must read as coloured dots from far away and shapes up close: ore rust
red, rock pale grey, coal black, plate steel blue, part brass, frame white
with dark corners.

## Buildings

Each sits on a stained concrete slab with expansion joints and a
hazard-striped front (dock) edge. Each has one signature moving part, which
is also its status display: it moves when working and stops when not.

| Building | Reads as | Signature motion |
|---|---|---|
| Hub | A hangar: four roller doors under a worn orange lintel, control tower with a lit cab and a lattice mast, tanks and ducts, stock bins on the roof | Dish turning |
| Extractor | A lattice drilling derrick with crown block, engine house and mud tank | Striped drill string hammering inside the lattice; exhaust puffing |
| Smelter | A small blast furnace: ribbed vessel, bustle pipe, skip incline, gas cleaner with the stack on top | Tuyeres, tap hole and runner glowing; stack smoking |
| Fabricator | A framed hall with roof plant, feeding a four-column hydraulic press | Yellow-and-black ram stamping |

Status, readable without a panel:

| State | Shows as |
|---|---|
| Working | Signature part moving, lights lit |
| Idle | Still, lights lit |
| Starved | Still; amber lamp blinking; the empty tray's rim pulses |
| Blocked | Still; amber lamp steady; output tray heaped |
| Unpowered | Lights dark (when power exists) |

## Haulers

Six-wheeled rovers: a steel tub on bogies, a flat cargo deck with a tube
rail, side armour, a hazard-striped bumper, dirt on the running gear. Plain
working hardware.

On a short neck sits a boxy screen head, tilted up about 35° so it faces the
camera. On its dark visor are **two eyes**: warm-white rounded rectangles,
a little taller than wide. That is the whole face.

Expression comes from only three things: the shape of the lit area, where
the pair looks, and blinking. Every expression is tied to something true in
the sim, so the eyes are also a readout:

| When | Eyes |
|---|---|
| Driving | Open; look into a turn before the body turns |
| Approaching pickup or drop | Look at the tray |
| Given a job while idle | Widen briefly |
| Delivered | A short happy squint, not every time |
| Giving way | Glance at the other bot |
| Stuck in a jam | Half-lidded |
| Parked and idle | Slow blinks, then closed: dozing |
| Cannot reach destination | Dim amber, looking around |

Keep expressions small. The contrast with the hardware does the work.
(Expressions are not implemented yet; the eyes are static.)

## Land

- **Ground**: scrubby grass with dry clumps, patches of bare dirt, loose
  stones. Bare dirt also surrounds the hub. Later, hauler traffic will wear
  grass to dirt: that is how roads will first appear.
- **Rock**: steep ground is rock, in cracked slabs with strata across cliff
  faces. A cliff's job is to say "bots cannot go here" at a glance.
- **Deposits**: the ground breaks into rock slabs with ore packed into the
  joints between them, low slabs of rock lying on top, and lumps of ore among
  them. Each resource is recognisable from the far zoom by colour.
- **Trees**: dark, slender spruces in forest patches, with the odd dead snag.
  Trees and boulders are real: haulers path around them, and building clears
  them.
- **Dressing**: shrubs at forest edges, grass tufts. Hidden under buildings
  and docks.
- **Smoke**: soft particles that rise, spread and lean downwind. Dark and
  sooty at the stack, paling as they thin.

## Ground paint and interface

- Dock aprons are quiet: thin off-white corner brackets and two or three
  small yellow chevrons. Paint is never the loudest thing in the frame.
- The interface is a light, flat DOM overlay: plain panels, dry text, a clean
  sans and a monospace for numbers. It should feel like instrumentation.
- Placement ghosts are translucent when valid and fault-red when not, with
  the reason in a small label.

## Do and don't

- Do keep idle things still. Motion means work.
- Do keep the three colour families apart.
- Don't round things off or simplify forms to look friendly.
- Don't use a signal colour decoratively.
- Don't give eyes to anything that doesn't move around on its own.
