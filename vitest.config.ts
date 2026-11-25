import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'db/**/*.test.ts'],
    exclude: ['node_modules/**', 'src/fitness/fixtures/**'],
    // ADR-21: every run needs a real PostgreSQL named by POSTGRES_URL; there is no in-memory fallback.
    globalSetup: ['src/server/test-support/postgres-global-setup.ts'],
    setupFiles: ['src/server/test-support/postgres-test-cleanup.ts'],
    // A real database is slower than memory: the latency reports (2,000 opens, 2,000 closes) and the fifty-fold F3 race
    // need more than the default five seconds. No expected value changes with it.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
