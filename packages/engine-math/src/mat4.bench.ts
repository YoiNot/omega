import { bench, describe } from 'vitest';
import { Mat4 } from './mat4.js';

describe('Mat4 throughput', () => {
  const a = Mat4.perspective(new Mat4(), 1.2, 16 / 9, 0.1, 100);
  const b = Mat4.translation(new Mat4(), 1, 2, 3);
  bench('multiply x 1000', () => {
    const out = new Mat4();
    for (let i = 0; i < 1000; i++) Mat4.multiply(out, a, b);
  });
});
