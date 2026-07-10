/**
 * @omega/physics-integration — integration-level component declarations.
 *
 * The pipeline binds rigid bodies to the ECS through the same store name the
 * @omega/physics `PhysicsSystem` already reads (`PHYSICS_BODY_STORE = 'PhysicsBody'`).
 * We declare the `PhysicsBody` handle with @omega/ecs `defineComponent` so consumers
 * get a typed, stable component identity — and because `defineComponent` keys by name,
 * `PhysicsBody.name === PHYSICS_BODY_STORE`, so the bodies we add under that name are
 * exactly what PhysicsSystem discovers each tick.
 *
 * `Transform` / `Velocity` are optional ECS-style view handles for code that wants to
 * mirror body state into a separate component column (e.g. for rendering); they are not
 * consumed by PhysicsSystem itself.
 */

import { defineComponent } from '@omega/ecs';
import { PHYSICS_BODY_STORE, type RigidBody } from '@omega/physics';

/** Typed handle for the rigid-body component stored under `PHYSICS_BODY_STORE`. */
export const PhysicsBody = defineComponent<RigidBody>(PHYSICS_BODY_STORE);

/** Optional view component: a body's position mirrored for render/query use. */
export const Transform = defineComponent<{ x: number; y: number; z: number }>('Transform');

/** Optional view component: a body's linear velocity mirrored for query use. */
export const Velocity = defineComponent<{ x: number; y: number; z: number }>('Velocity');
