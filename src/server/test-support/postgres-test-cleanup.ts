import { afterAll, afterEach, beforeEach } from 'vitest';
import { closeTestDatabases, closeTheTestsDatabases, markInsideATest } from './postgres-test-database';

/**
 * Test-only, a vitest setup file: a test database a test opened closes when that test ends; one a file's set-up opened
 * (at the top of a file, in a describe or a beforeAll) closes when the file ends. Connections never pile up.
 */
beforeEach(() => markInsideATest(true));
afterEach(async () => {
  markInsideATest(false);
  await closeTheTestsDatabases();
});
afterAll(closeTestDatabases);
