# Visual style

## The idea

A well-made **scale model of an automated industrial colony**, on a table, in
good light. Clean, matte, slightly chunky. Everything is engineered and
purposeful; nothing is a joke. The charm comes from small machines taking
their small jobs seriously.

**Charm through motion and manners, never through jokes.** No faces, no speech
bubbles, no funny names, no wacky proportions. A hauler that brakes a little
too eagerly, parks precisely in a row, and waits its turn at a tiny traffic
light — that is the register.

## Rendering rules

- Procedural geometry, flat colours from the palette, no textures. Soft
  bevels on anything man-made so edges catch light.
- Matte materials (roughness ≈ 0.8). A little sheen on metal items only.
- One warm directional sun at about 40° elevation with soft shadows; a cool
  hemisphere fill. Neutral tone mapping. No outlines, no bloom except a
  restrained glow on lamps and furnace mouths.
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
  Each sits on a low graphite plinth, which also hides uneven ground.
- White hull, graphite structure, one accent stripe.
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

- Docks are a marked apron: a painted outline with hazard chevrons.
- Input and output trays are open, so buffer stacks are visible.

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

- Small rounded wheeled bots, about 1.2 m long: graphite chassis, white shell,
  orange stripe, a single lit visor strip at the front. Not a face.
- Cargo rides visibly on a flat bed, stacked.
- Motion carries the personality: slight suspension bob, a lean into turns, a
  small forward dip when braking, a brief pause before pulling out into
  traffic, neat reverse-parking in rows at the hub.
- Deliberately a little large relative to buildings, so they read from afar.

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
