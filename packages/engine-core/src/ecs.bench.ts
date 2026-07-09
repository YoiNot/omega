import { bench, describe } from 'vitest';
import { World } from './ecs.js';

describe('ECS throughput', () => {
  bench('spawn 1000 entities with 2 components', () => {
    const w = new World();
    for (let i = 0; i < 1000; i++) {
      const id = w.createEntity();
      w.addComponent('Pos', id, { x: i, y: 0, z: 0 });
      w.addComponent('Vel', id, { vx: 0, vy: 0, vz: 0 });
    }
  });
  bench('query 1000 entities', () => {
    const w = new World();
    for (let i = 0; i < 1000; i++) {
      const id = w.createEntity();
      w.addComponent('Pos', id, { x: i, y: 0, z: 0 });
      w.addComponent('Vel', id, { vx: 0, vy: 0, vz: 0 });
    }
    for (const _id of w.query('Pos', 'Vel').ids) void _id;
  });
});
