/**
 * @omega/nav — deterministic grid/heightmap pathfinding for the simulation.
 *
 * Components:
 *   - {@link NavGrid}  : 2D cost grid (walkable / penalty / blocked)
 *   - {@link MinHeap}  : binary min-heap with configurable comparator
 *   - {@link astar}    : A* shortest-cost path (4/8-neighbour, deterministic)
 *   - {@link flowField}: single-source flow field for many agents / one goal
 */

export { MinHeap } from './heap.js';
export {
  NavGrid,
  type Cell,
  type NavGridOptions,
} from './grid.js';
export { astar, type AStarOptions } from './astar.js';
export {
  flowField,
  flowStep,
  DIR_OFFSETS,
  type FlowField,
} from './flow.js';
