# @omega/engine-math

Deterministic linear algebra and scalar math for the OMEGA engine. No ambient state, so it
is safe to use inside seeded generation and simulation.

## API

### Scalars (`math.ts`)
`clamp`, `clamp01`, `lerp`, `invLerp`, `smoothstep`, `smootherstep`, `bilerp`, `fract`,
`sign`, `moveToward`, `wrapAngle`, `ipow`, plus constants `PI`, `TAU`, `HALF_PI`,
`DEG2RAD`, `RAD2DEG`.

### Vectors (`vec.ts`)
`Vec2`, `Vec3`, `Vec4` — each with `add`, `sub`, `scale`, `addScaled`, `dot`, `length`,
`normalize`, `clone`, `copy`, `set`, and static helpers (`distance`, `cross`, `lerp`, …).

### Matrices (`mat4.ts`)
`Mat4` (column-major Float32Array(16)) — `identity`, `multiply`, `perspective`,
`ortho`, `lookAt`, `translation`, `scaling`, `transformPoint`, `transformDir`,
`getTranslation`. `perspectiveFov` convenience wrapper.

### Quaternions (`quat.ts`)
`Quat` (x,y,z,w) — `fromAxisAngle`, `fromEuler`, `multiply`, `rotate`, `slerp`, `toEuler`,
`normalize`.

## Tests
See `src/*.test.ts` (33 tests). Run `npx vitest run packages/engine-math`.

## Design notes
- Matrices are column-major to match WebGL/WebGPU `uniformMatrix4fv` expectations.
- All operations are pure and allocation-light; reuse instances in hot loops.
