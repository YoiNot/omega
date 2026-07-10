/**
 * @omega/nav-core — deterministic grid/coordinate pathfinding.
 *
 * Decoupled from the ECS: operates purely on integer tile coordinates via the
 * {@link Grid} abstraction (never on entities/components).
 *
 * Components:
 *   - {@link Grid}, {@link BooleanGrid} : tile grid with `isBlocked(x, y)`
 *   - {@link MinHeap}                   : binary min-heap with comparator
 *   - {@link findPath}                  : deterministic A* (`Vec2[]`, stable ties)
 *   - {@link flowField}                 : distance field (`number[][]`) for groups
 */

export { MinHeap } from './heap.js';
export {
  BooleanGrid,
  type Grid,
  type Path,
} from './grid.js';
export { findPath, type FindPathOptions } from './find-path.js';
export { flowField, type DistanceField } from './flow.js';
