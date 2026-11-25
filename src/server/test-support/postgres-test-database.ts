import pg from 'pg';
import { inject } from 'vitest';
import { PostgresDatabase } from '../adapters/postgres/postgres-database';
import { readPostgresUrl } from '../adapters/postgres/postgres-url';
import { TEST_APPLICATION_PASSWORD, TEST_APPLICATION_ROLE, testRunPrefix, urlFor } from './postgres-test-names';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Set by postgres-global-setup.ts: the prefix of this run's test databases. */
    sayesTestRun: string;
  }
}

export interface TestDatabase {
  readonly database: PostgresDatabase;
}

const opened: PostgresDatabase[] = [];
let admin: pg.Pool | undefined;
let counter = 0;

/**
 * Test-only: a fresh database for one test application, cloned from the run's migrated template, so every composition
 * starts empty, as `new InMemoryDatabase()` did. It is returned at once and created meanwhile; every statement waits
 * for it. The pools close when the test file ends (postgres-test-cleanup.ts).
 */
export function freshTestDatabase(): PostgresDatabase {
  const adminUrl = readPostgresUrl(process.env);
  const prefix = testRunPrefix(inject('sayesTestRun'));
  const name = `${prefix}${process.pid}_${(counter += 1)}`;
  admin ??= new pg.Pool({ connectionString: adminUrl, max: 2 });
  const created = admin.query(`CREATE DATABASE "${name}" TEMPLATE "${prefix}template"`).then(() => undefined);
  const url = urlFor(adminUrl, name, { user: TEST_APPLICATION_ROLE, password: TEST_APPLICATION_PASSWORD });
  const pool = () => new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 1_000, allowExitOnIdle: true });
  const database = new PostgresDatabase(pool(), pool(), created);
  opened.push(database);
  return database;
}

/** The same, for a test that wants the database to exist before it goes on. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const database = freshTestDatabase();
  await database.committed.query('SELECT 1');
  return { database };
}

/** Closes every test database this test file opened; postgres-test-cleanup.ts calls it after each file. */
export async function closeTestDatabases(): Promise<void> {
  const closing = opened.splice(0).map((database) => withinSeconds(database.close(), 5));
  await Promise.all(closing);
  await withinSeconds(admin?.end() ?? Promise.resolve(), 5);
  admin = undefined;
}

/** A pool still lending a client to an unfinished transaction never ends; the run's teardown drops its database anyway. */
function withinSeconds(work: Promise<void>, seconds: number): Promise<void> {
  return Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000).unref())]);
}
