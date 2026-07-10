import { defineConfig } from 'vitest/config';

// Scoped config for the apps/* demos (browser apps live outside packages/*).
// Mirrors the root vitest config's settings but widens the include to apps/.
export default defineConfig({
  test: {
    include: ['apps/*/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.bench.ts', '**/index.ts', '**/renderer.ts', '**/main.tsx'],
    },
  },
});
