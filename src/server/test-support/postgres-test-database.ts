import pg from 'pg';
import { afterAll, inject } from 'vitest';
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
  readonly name: string;
  /** The connection string of the database for the application role. */
  readonly url: string;
}

const opened: PostgresDatabase[] = [];
let admin: pg.Pool | undefined;
let counter = 0;

/**
 * Test-only: a fresh database for one test application, cloned from the run's migrated template, so every composition
 * starts empty, as `new InMemoryDatabase()` did. The pools close when the test file ends.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = readPostgresUrl(process.env);
  const prefix = testRunPrefix(inject('sayesTestRun'));
  const name = `${prefix}${process.pid}_${(counter += 1)}`;
  admin ??= new pg.Pool({ connectionString: adminUrl, max: 2 });
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${prefix}template"`);
  const url = urlFor(adminUrl, name, { user: TEST_APPLICATION_ROLE, password: TEST_APPLICATION_PASSWORD });
  const pool = () => new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 1_000, allowExitOnIdle: true });
  const database = new PostgresDatabase(pool(), pool());
  opened.push(database);
  return { database, name, url };
}

afterAll(async () => {
  const closing = opened.splice(0).map((database) => withinSeconds(database.close(), 5));
  await Promise.all(closing);
  await withinSeconds(admin?.end() ?? Promise.resolve(), 5);
  admin = undefined;
});

/** A pool still lending a client to an unfinished transaction never ends; the run's teardown drops its database anyway. */
function withinSeconds(work: Promise<void>, seconds: number): Promise<void> {
  return Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000).unref())]);
}
