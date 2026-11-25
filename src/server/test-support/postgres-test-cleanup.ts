import { afterAll } from 'vitest';
import { closeTestDatabases } from './postgres-test-database';

/** Test-only, a vitest setup file: after each test file, close the pools of the test databases it opened. */
afterAll(closeTestDatabases);
