import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'db/**/*.test.ts'],
    exclude: ['node_modules/**', 'src/fitness/fixtures/**'],
    // ADR-21: every run needs a real PostgreSQL named by POSTGRES_URL; there is no in-memory fallback.
    globalSetup: ['src/server/test-support/postgres-global-setup.ts'],
  },
});
