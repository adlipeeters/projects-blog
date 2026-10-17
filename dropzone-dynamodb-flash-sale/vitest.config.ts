import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// One config, three suites, selected by path on the command line:
//   pnpm test:unit         fast, no Docker
//   pnpm test:integration  DynamoDB Local in Testcontainers, tables built from schema/tables.json
//   pnpm test:e2e          against a deployed dev stage, needs AWS credentials
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Integration and e2e suites talk to real containers or AWS, so they get room to breathe.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Tables are shared per suite; parallel files would fight over the same items.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
