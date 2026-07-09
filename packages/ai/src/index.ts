/**
 * @omega/ai — artificial intelligence for PROJECT OMEGA.
 *
 * Exposes the GOAP planner, utility AI scorer/selector, and the ECS `Brain` adapter that
 * emits `'agent:decision'` events through @omega/engine-core's EventBus.
 */

export * from './goap.js';
export * from './utility.js';
export * from './agent.js';
