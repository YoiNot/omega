/**
 * @omega/fuzz — ECS fuzz target harness.
 *
 * A ready-to-use `fuzz` target that drives an @omega/ecs World with
 * PRNG-seeded operations (create/destroy/attach/detach/query). The harness is
 * itself deterministic: given the same seed it rebuilds the exact same
 * sequence of operations. Pair this with `fuzz()` to hunt for crashes in the
 * ECS core (e.g. double-free, query-after-destroy, attach/detach imbalance).
 */

import { Rng } from '@omega/engine-core';
import {
  World,
  defineComponent,
  type ComponentDef,
  type EntityId,
} from '@omega/ecs';

const Position = defineComponent<{ x: number; y: number }>('fuzz-position');
const Velocity = defineComponent<{ vx: number; vy: number }>('fuzz-velocity');
const Health = defineComponent<{ hp: number }>('fuzz-health');

const ALL: readonly ComponentDef<unknown>[] = [Position, Velocity, Health];

/** One seeded operation applied to a fresh World. */
export type EcsOp =
  | { kind: 'create' }
  | { kind: 'destroy'; id: EntityId }
  | { kind: 'attach'; id: EntityId; type: number }
  | { kind: 'detach'; id: EntityId; type: number }
  | { kind: 'set'; id: EntityId; type: number }
  | { kind: 'query' };

function applyOp(world: World, op: EcsOp, rng: Rng): void {
  switch (op.kind) {
    case 'create':
      world.createEntity();
      return;
    case 'destroy': {
      if (world.isAlive(op.id)) world.destroyEntity(op.id);
      return;
    }
    case 'attach': {
      if (world.isAlive(op.id)) {
        const t = ALL[op.type % ALL.length];
        // pre-attach with a deterministic value so set() has something to replace
        world.addComponent(op.id, t as ComponentDef<{ x: number; y: number }>, {
          x: rng.nextInt(-1000, 1000),
          y: rng.nextInt(-1000, 1000),
        } as never);
      }
      return;
    }
    case 'detach': {
      if (world.isAlive(op.id)) {
        const t = ALL[op.type % ALL.length];
        world.removeComponent(op.id, t as ComponentDef<{ x: number; y: number }>);
      }
      return;
    }
    case 'set': {
      if (world.isAlive(op.id)) {
        const t = ALL[op.type % ALL.length];
        if (world.hasComponent(op.id, t as ComponentDef<unknown>)) {
          world.setComponent(op.id, t as ComponentDef<{ hp: number }>, {
            hp: rng.nextInt(0, 100),
          } as never);
        }
      }
      return;
    }
    case 'query': {
      // Iterating must never throw, even on an empty / partially-broken world.
      world.query(Position, Velocity).each((id, p, v) => {
        void id; void p; void v;
      });
      world.query(Health).each((id, h) => {
        void id; void h;
      });
      return;
    }
  }
}

/**
 * Run a deterministic sequence of seeded ECS operations. Throws propagate to
 * the fuzzer as a crash. `seed` fully determines the operation sequence.
 */
export function runEcsFuzz(seed: number | string | bigint, iterations: number): void {
  const rng = new Rng(seed);
  const world = new World();
  // Track the most recently created entity so destroy/attach/set target a real id.
  let lastId = 0;
  for (let i = 0; i < iterations; i++) {
    const roll = rng.nextInt(0, 5);
    let op: EcsOp;
    switch (roll) {
      case 0:
        lastId = world.createEntity();
        op = { kind: 'create' };
        break;
      case 1:
        op = { kind: 'destroy', id: lastId };
        break;
      case 2:
        op = { kind: 'attach', id: lastId, type: rng.nextInt(0, ALL.length - 1) };
        break;
      case 3:
        op = { kind: 'detach', id: lastId, type: rng.nextInt(0, ALL.length - 1) };
        break;
      case 4:
        op = { kind: 'set', id: lastId, type: rng.nextInt(0, ALL.length - 1) };
        break;
      default:
        op = { kind: 'query' };
    }
    applyOp(world, op, rng);
  }
}
