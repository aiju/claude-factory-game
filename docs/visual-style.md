# Visual style

## The idea

A well-made **scale model of an automated industrial colony**, on a table, in
good light. Clean, matte, slightly chunky. Everything is engineered and
purposeful; nothing is a joke. The charm comes from small machines taking
their small jobs seriously.

**The bots are the characters; the factory is the set.** Things that move
around on their own have eyes and a little personality. Buildings, links and
terrain do not: they stay straight-faced industrial hardware, which is what
makes the bots read as inhabitants rather than as decoration.

**Charm through eyes, motion and manners, never through jokes.** No mouths, no
speech bubbles, no funny names, no wacky proportions. A hauler that glances at
the bot it is giving way to, brakes a little too eagerly, parks precisely in a
row and dozes off — that is the register.

## Rendering rules

- Procedural geometry, flat colours from the palette, no textures. Soft
  bevels on anything man-made so edges catch light.
- Matte materials (roughness ≈ 0.8). A little sheen on metal items only.
- One warm directional sun at about 50° elevation with soft shadows; a cool
  hemisphere fill. Neutral tone mapping. No outlines, no bloom except a
  restrained glow on lamps and furnace mouths.
- **Bright, not overcast.** Check against these on a screenshot: sunlit hull
  reads as warm white (around 90% brightness), not grey; sunlit ground matches
  the palette sage rather than olive; shadowed ground is no darker than about
  60% of lit ground; graphite never clips to black — a graphite object in
  shade still shows its form. Shadows are short and soft-edged.
- **Design for the view from above.** The camera looks down at 35–65°, so
  roofs and top surfaces are most of what the player sees. Anything that
  matters (signature part, trays, lamp, a bot's eyes) must face upwards
  enough to be seen from there.
- Light distance fog in the sky colour, to give depth and hide the map edge.
- Camera: perspective with a narrow field of view (about 30°) for the
  miniature look. Pitch between 35° and 65°. Zoom from about 15 m to 200 m.
- No day/night cycle for now.

## Palette

Nature is muted and slightly desaturated so that machines and items stand out.

| Role | Colour | |
|---|---|---|
| Ground | `#A9B49A` | sage; vary towards `#9AA88C` and dry `#C2B99A` |
| Cliff, exposed rock | `#6E7480` | shadows `#575C68` |
| Track (worn ground) | `#B8A98A` | dusty, soft-edged |
| Road | `#4A4E57` | edge and centre marks `#E8E4D8` |
| Sky / fog | `#DCE6EA` → `#F3EFE6` | top to horizon |
| Hull (building panels) | `#E9E6DF` | warm white; secondary `#C9CCD1` |
| Structure (frames, pylons, wheels) | `#2E3238` | graphite |
| Logistics accent | `#F28C28` | haulers, conveyor trim, link UI |
| Power accent | `#3CC8C8` | cables, generator trim, powered windows |
| Hazard / construction | `#F2C230` | |
| Status: fault | `#E5484D` | |
| Status: ok | `#58C27D` | |

Items must read as coloured dots from far away and as shapes up close:

| Item | Colour | Shape |
|---|---|---|
| Ore | `#B5573A` | rough chunk |
| Rock | `#B9B6AE` | pale angular chunk |
| Coal | `#26282C` | dark faceted lump |
| Plate | `#8FA6BF` | flat slab |
| Part | `#D9A441` | short cylinder with a notch |
| Frame | `#E9E6DF` with `#2E3238` edges | open cube |

Accent colours are functional. Orange always means logistics, cyan always
means power. Do not use them decoratively.

## Buildings

- Chunky silhouettes that are distinct from each other at maximum zoom-out.
  Each sits on a low graphite plinth, which also hides uneven ground. The
  plinth is a thin skirt, barely wider than the building — never a slab.
- White hull, graphite structure. A second, slightly darker hull tone
  (`#C9CCD1`) breaks up large faces.
- **The roof is the building's face.** Never a blank plane: it carries the
  signature part, and enough secondary form (a raised housing, vents, a
  hatch, panel seams) to read as a machine rather than a box.
- **No accent band around buildings.** Orange appears on a building only
  where goods cross its boundary: the lip of each tray and the dock edge.
- **Each building has one signature moving part**, and that part is also its
  status display: it moves when working and stops when not.

| Building | Silhouette | Signature motion |
|---|---|---|
| Hub | Low, wide, a short mast | Slowly turning dish; hauler bays along the front |
| Extractor | Squat tower over the deposit | Piston driving down and up |
| Smelter | Box with a tall stack | Glowing mouth; round smoke puffs from the stack |
| Fabricator | Long shed with a raised press housing | Press stamping |
| Generator | Drum on a frame | Spinning flywheel |
| Pylon | Slim mast with a ring | Cyan ring lit when live |

- Docks are a marked apron, and ground paint is **quiet**: thin lines in the
  road-mark off-white (`#E8E4D8`), with hazard yellow only for a few small
  chevrons at the entry. The apron is no larger than the bots need. Paint
  must never be the loudest thing in the frame.
- Input and output trays are open, so buffer stacks are visible.
- The hub's bays are lit inside, not black voids. Its roof bins are the
  stock display: large enough to read at factory zoom, with stack height
  showing how much is there.
- Smoke puffs are off-white, and shrink and fade as they rise.

## Terrain

- Cliffs are real faces, not dark smears: steep, in the cliff colour, with a
  crisp top edge and enough light on them to see facets. Elevation is minor
  in this game, so a cliff's only job is to say "bots cannot go here" at a
  glance.
- Ground colour variation is subtle and broad. A sparse scatter of small
  stones or tufts is welcome if cheap; it gives the eye a sense of scale.
- Deposits (tinted ground plus scattered chunks) are right as they are.

## Status language

Readable without opening a panel:

| State | Shows as |
|---|---|
| Working | Signature part moving, windows lit cyan |
| Idle (nothing to do) | Still, windows lit |
| Starved | Still; amber lamp blinking slowly; the empty tray's outline pulses |
| Blocked (output full) | Still; amber lamp steady; output tray visibly heaped |
| Unpowered | Windows dark, red lamp |
| Brownout | Motion slowed, windows dim and flickering slightly |

## Haulers

- Small rounded wheeled bots: graphite chassis, white shell, orange stripe,
  and a dark glossy visor panel across the front.
- **From above, a hauler is mostly white with an orange stripe**; the dark
  chassis is only glimpsed at the wheels. The visor is raked well back
  (around 45°), like a windscreen, so the eyes face the camera.
- **Size by readability**, not realism: at the default factory zoom a hauler
  should be unmistakable, with its cargo and the direction it faces clear.
  Grow them (nominal size and nav radius together) until that holds.
- Cargo rides visibly on a flat bed, stacked.
- Motion carries half the personality: slight suspension bob, a lean into
  turns, a small forward dip when braking, a brief pause before pulling out
  into traffic, neat reverse-parking in rows at the hub.
- Deliberately a little large relative to buildings, so they read from afar.

### Eyes

Two eyes, drawn as lit shapes on the visor — a display, not anatomy. Warm
white (`#FFF4D6`), soft rounded rectangles a little taller than wide, set
fairly wide apart. That is the whole face: no mouth, no brows, no pupils.

Expression comes from only three things: the **shape** of the lit area (lids
are just the shape being cropped), where the pair **looks** (both eyes slide
together within the visor), and **blinking**. Keep it understated; a bot
should look attentive by default, not excited.

Every expression is tied to something true in the sim, so eyes are also a
readout:

| When | Eyes |
|---|---|
| Driving | Open; look slightly ahead into turns *before* the body turns |
| Approaching pickup or drop | Look at the tray |
| Given a job while idle | Widen briefly, then normal |
| Delivered | A short happy squint (upward arcs), about half a second; not every time |
| Giving way | Glance at the other bot, then back to the road |
| Stuck in a jam for a while | Half-lidded, flat |
| Straining (uphill, loaded) | Slightly narrowed |
| Parked and idle | Slow blinks, then closed to thin lines: dozing |
| Cannot reach destination | Dim amber, looking around |

- Blink at irregular intervals; never two neighbouring bots in sync.
- From far away the eyes are just two bright dots, which is enough to tell
  front from back and to make a queue of bots look like a queue of *someones*.
- *Suggested implementation:* a small expression atlas or shader on the visor
  quad, driven by per-instance attributes (expression, gaze offset, blink
  phase), so it stays cheap with hundreds of bots.

Later self-moving machines (carts, ropeway buckets perhaps) may get the same
eyes. Arms do not: they are part of a building.

## Links

- **Conveyor**: slim graphite truss on thin pylons, orange edge trim, items
  gliding along at an even spacing. Gentle curves, never sharp corners.
- **Arm**: a stubby two-joint arm on a turntable base, swinging with a clear
  pick–swing–place rhythm and a tiny settle at the end of each move.
- **Ropeway**: lattice towers, open buckets swaying slightly, a terminal with
  a big visible wheel.
- **Power cables**: thin, cyan-tinted, with a little sag.

## Roads and signals

- Tracks appear as soft-edged dusty wear; roads as crisp dark paving with pale
  edge marks. The transition should feel like something that grew.
- Signals, when they come, are tiny and entirely earnest: proper little
  lights on proper little posts.

## Interface

- DOM overlay, light and flat: warm-white panels (`#F3EFE6` at slight
  transparency), graphite text, 6 px corners, thin borders, no gradients.
- A clean sans for text and a monospace for numbers (system font stacks for
  now).
- Ghosts for placement are translucent hull-white when valid and fault-red
  when not, with the reason in a small label.
- Overlays draw in the world (lines, tinted ground), not as separate maps.

## Do and don't

- Do make idle things calm. Motion should mean work is happening.
- Do keep the ground readable: it is where traffic tells its story.
- Don't add detail that doesn't carry information or character.
- Don't use more than one accent colour on one object.
- Don't give faces to anything that doesn't move around on its own.
- Don't let expressions get big. If it would look at home in a cartoon, halve it.
