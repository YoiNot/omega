import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    benchmark: {
      include: ['packages/*/src/**/*.bench.ts'],
    },
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.bench.ts', '**/index.ts'],
      thresholds: {
        // Roadmap target is 95%; we enforce a strict floor from day one.
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
