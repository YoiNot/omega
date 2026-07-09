/**
 * @omega/time — deterministic fixed-timestep clock and frame interpolation.
 *
 * The timing backbone for @omega/ecs / @omega/sim: drive a simulation at a fixed
 * rate and interpolate render state between steps without ever reading a clock.
 */

export { FixedTimestep } from './clock.js';
export type { TickCallback } from './clock.js';
export { lerpState, lerpVec3 } from './interpolate.js';
export type { Vec3 } from '@omega/engine-math';
