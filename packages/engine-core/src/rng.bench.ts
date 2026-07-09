import { bench, describe } from 'vitest';
import { Rng } from './rng.js';

describe('Rng throughput', () => {
  const rng = new Rng(123456789);
  bench('nextF64 x 1000', () => {
    for (let i = 0; i < 1000; i++) rng.nextF64();
  });
  bench('nextInt(0,100) x 1000', () => {
    for (let i = 0; i < 1000; i++) rng.nextInt(0, 100);
  });
});
