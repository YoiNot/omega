# Vision

PROJECT OMEGA aims to be a browser game whose scope rivals the great simulation sandboxes
— a deterministic, infinitely-generated universe where geology, climate, ecology, economy,
and autonomous agents all *emerge* from rules rather than scripts.

We will not pretend to ship all of that at once. We will ship a spine that is correct,
tested, and extensible, and grow it subsystem by subsystem with the same engineering
discipline a world-class studio applies to each increment.

## Non-goals (explicit)
- We do not clone or reimplement any proprietary engine, asset, or copyrighted content.
- We do not ship mock implementations that only *look* complete. A subsystem is "done"
  only when it has a real implementation and passing tests.

## Guiding constraints
- Deterministic from seed — reproducibility is a feature, not an afterthought.
- Browser-first; WebGPU when available, WebGL2 fallback.
- Runs on modest hardware (this foundation was built and tested on a 4-core laptop).
- Engine and content are separate; modding is a first-class design axis (future milestone).
