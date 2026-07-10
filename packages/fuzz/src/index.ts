/**
 * @omega/fuzz — deterministic fuzzer for PROJECT OMEGA.
 *
 * Public surface: the `fuzz(generate, fn, opts)` runner, the ECS fuzz harness,
 * and `toFuzzJson` for emitting reproducible crash reports.
 */

export {
  fuzz,
  toFuzzJson,
} from './fuzz.js';
export type {
  FuzzOptions,
  FuzzInput,
  FuzzGen,
  FuzzFn,
  FuzzFailure,
  FuzzResult,
} from './fuzz.js';
export { runEcsFuzz } from './ecs-target.js';
export type { EcsOp } from './ecs-target.js';
