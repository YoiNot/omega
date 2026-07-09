# PROJECT OMEGA

> An autonomous, architecturally-sound browser game engine and universe simulator.

PROJECT OMEGA is a long-horizon engineering effort to build an original browser game
engine and a deeply simulated universe, structured so that the hundreds of subsystems
described in the brief can be added iteratively without breaking architecture.

This repository is the **real, runnable foundation**: a monorepo containing a seeded
deterministic engine core (math, PRNG, ECS, scheduler, events), procedural world
generation, a physics step, a node-testable renderer, a versioned save system, and a
simulation loop — all with passing tests.

The brief describes an unbounded target ("millions of LOC / 50 engineers / 3 years").
The engineering-honest way to pursue an unbounded target is to *never skip architecture*,
*never fake a subsystem*, and *always extend a working spine*. That is what this repo does.

## Status

| Subsystem      | Package            | State        |
|----------------|--------------------|--------------|
| Engine math    | `@omega/engine-math` | implemented  |
| Engine core    | `@omega/engine-core` | implemented  |
| World gen      | `@omega/world-gen`   | implemented  |
| Physics        | `@omega/physics`     | implemented  |
| Renderer       | `@omega/render`      | implemented* |
| Save system    | `@omega/save`        | implemented  |
| Simulation     | `@omega/sim`         | implemented  |
| Demo app       | `apps/web`           | implemented  |

\* The WebGL renderer requires a browser/document; its *mesh-building* and *command
encoding* are unit-tested in Node. The GL context itself is exercised by the demo app.

## Quick start

```bash
npm install
npm run build
npm test
npm run typecheck
cd apps/web && npm run dev   # playable in the browser
```

## Repository layout

```
omega/
  packages/
    engine-math/   linear algebra + deterministic math
    engine-core/   PRNG, ECS, scheduler, event bus
    world-gen/     seeded noise, terrain, planets, universe
    physics/       rigid-body integration + broadphase
    render/        WebGL2 renderer + heightfield mesh builder
    save/          versioned binary serialization + migration
    sim/           fixed-timestep simulation orchestration
  apps/
    web/           Vite + React demo (generate / play / autosave)
  docs/
    VISION.md ARCHITECTURE.md ROADMAP.md adr/
  .github/workflows/ci.yml
```

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full milestone plan and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.
