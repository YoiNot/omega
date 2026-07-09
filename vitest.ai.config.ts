import { defineConfig } from 'vitest/config';

// Scoped config for @omega/ai: only this package's sources, no global monorepo scan.
export default defineConfig({
  test: {
    include: ['packages/ai/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/ai/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.bench.ts', '**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
