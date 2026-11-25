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

/** Every open test database, and whether a test (rather than a file's set-up) opened it. */
const opened: { readonly database: PostgresDatabase; readonly byATest: boolean }[] = [];
let insideATest = false;
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
  // Small pools: many test databases are open at once across the workers, and PostgreSQL allows about a hundred connections.
  const pool = (max: number) => new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 200, allowExitOnIdle: true });
  const database = new PostgresDatabase(pool(3), pool(5), created);
  opened.push({ database, byATest: insideATest });
  return database;
}

/** The same, for a test that wants the database to exist before it goes on. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const database = freshTestDatabase();
  await database.committed.query('SELECT 1');
  return { database };
}

/** postgres-test-cleanup.ts marks where a test starts and ends, so a database a test opened closes with it. */
export function markInsideATest(inside: boolean): void {
  insideATest = inside;
}

/** Closes the test databases the test that just ended opened. */
export async function closeTheTestsDatabases(): Promise<void> {
  await closeWhere((entry) => entry.byATest);
}

/** Closes every test database this test file still holds, and the file's admin pool. */
export async function closeTestDatabases(): Promise<void> {
  await closeWhere(() => true);
  await withinSeconds(admin?.end() ?? Promise.resolve(), 2);
  admin = undefined;
}

async function closeWhere(chosen: (entry: (typeof opened)[number]) => boolean): Promise<void> {
  const closing = opened.filter(chosen);
  for (const entry of closing) {
    opened.splice(opened.indexOf(entry), 1);
  }
  await Promise.all(closing.map((entry) => withinSeconds(entry.database.close(), 2)));
}

/** A pool still lending a client to an unfinished transaction never ends; the run's teardown drops its database anyway. */
function withinSeconds(work: Promise<void>, seconds: number): Promise<void> {
  return Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000).unref())]);
}
