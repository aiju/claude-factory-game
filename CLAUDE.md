# Factory game

A browser factory game: 3D-rendered, god-view RTS controls, gridless placement.
Hauler bots carry everything by default; the player hardens busy flows into
conveyors, arms, ropeways and so on. Read `docs/design.md` first — it is short.

## Docs

| File | What it is |
|---|---|
| `docs/design.md` | Game design: pillars, systems, starter content, tunables |
| `docs/visual-style.md` | Look, palette, motion, tone |
| `docs/architecture.md` | Stack, module layout, hard rules, chosen algorithms |
| `docs/roadmap.md` | Milestones with "done when" criteria, and current status |
| `docs/notes.md` | Implementer's log: calls made, questions for design review |

## How work is split

There are two roles, usually in separate sessions:

- **Design lead** owns the docs above (except `notes.md`): game design, visual
  design, tone, and the choice of algorithms and architecture.
- **Implementer** owns the code: builds milestones from `docs/roadmap.md`.

If you are implementing:

- The docs say what and why; how is yours. Where a doc is silent or a detail
  is marked *suggested*, use your judgment and keep going.
- Things marked **decided** or listed under "Hard rules" are not yours to
  change unilaterally. If one turns out to be wrong or costly, say so in
  `docs/notes.md` and tell Emily; carry on with whatever doesn't depend on it.
- Log notable calls you made, and taste-heavy questions (how something should
  look, feel or play), in `docs/notes.md`. Make a reasonable provisional
  choice rather than blocking.
- Numbers in the design doc are starting values. Keep them in `src/data/` so
  they are easy to tune, and feel free to adjust them to make things work —
  note it when you do.
- Update the status line of a milestone in `docs/roadmap.md` when you finish it.

## Conventions

- TypeScript strict, Vite, three.js, Vitest. Add other runtime dependencies
  only with a reason worth writing down.
- `src/sim/` never imports three.js or touches the DOM. See architecture doc.
- World units are metres, Y is up, the ground is the XZ plane.
- Every sim feature gets at least one headless scenario test.
- Player-facing text is plain and dry. No jokes, no exclamation marks.
- Do not put AI model names in code, comments, docs or commit messages.

## Commands

```bash
npm install          # once
npm run dev          # dev server at http://localhost:5173
npm test             # headless sim tests (Vitest)
npm run typecheck    # tsc, no emit
npm run build        # typecheck + production build into dist/
npm run shots        # screenshots into shots/ (all, or name some: npm run shots -- hub)
npm run encounters   # hauler-meets-hauler cases on open ground, timed against driving alone
npm run traffic      # how haulers spend road time in a scenario, and where they stall
```

The screenshot script starts its own dev server on port 5199 and drives a
headless Chromium (Playwright, not a project dependency: it uses the globally
installed one). Shots are listed at the top of `scripts/shots.mjs`; a shot can
name a debug scenario (`?scenario=` in `src/debug/scenarios.ts`) and a number
of ticks to run first. URL parameters for the dev server: `cam=x,z,dist,yawDeg,pitchDeg`,
`scenario=name`, `noedge` (no edge-scroll), `paused`, `traffic` (overlay on).
