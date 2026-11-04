import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Task Z2: as the application's database role, UPDATE and DELETE on audit_log must both be refused.
 * Runs only against a real PostgreSQL named by DATABASE_URL (connect as the database owner). Everything happens in one
 * transaction that is rolled back, so the database is left as it was. Needs the `pg` package installed locally.
 */
const databaseUrl = process.env['DATABASE_URL'];
const PERMISSION_DENIED = '42501';

interface QueryClient {
  connect(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

interface PostgresDriver {
  Client: new (options: { connectionString: string }) => QueryClient;
}

if (databaseUrl === undefined) {
  console.log('Z2 test skipped: DATABASE_URL is not set, so there is no PostgreSQL to try UPDATE and DELETE against.');
}

describe.skipIf(databaseUrl === undefined)('audit_log is append-only for the application role (Z2)', () => {
  it('refuses UPDATE and DELETE as sayes_application', async () => {
    const client = await connect(databaseUrl ?? '');
    try {
      await client.query('BEGIN');
      await client.query(await readFile(path.join(process.cwd(), 'db', 'migrations', '0001_schemas.sql'), 'utf8'));
      await client.query('SET LOCAL ROLE sayes_application');
      await client.query(
        `INSERT INTO audit_log.audit_log
           (id, prev_hash, hash, person_id, role, operation, input, request_id, recorded_at)
         VALUES (1, repeat('0', 64), repeat('a', 64), 'chair-1', 'chair', 'test', '{}', 'request-0001', now())`,
      );
      const updateRefusal = await refusalOf(client, `UPDATE audit_log.audit_log SET reason = 'edited' WHERE id = 1`);
      const deleteRefusal = await refusalOf(client, `DELETE FROM audit_log.audit_log WHERE id = 1`);
      console.log(`Z2 report: UPDATE refused with "${updateRefusal}"; DELETE refused with "${deleteRefusal}"`);
      expect(updateRefusal).toContain('permission denied');
      expect(deleteRefusal).toContain('permission denied');
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});

async function connect(connectionString: string): Promise<QueryClient> {
  const driverName = 'pg';
  const driver = (await import(driverName).catch(() => {
    throw new Error('The Z2 test needs the pg package: run `npm install --no-save pg` first.');
  })) as PostgresDriver;
  const client = new driver.Client({ connectionString });
  await client.connect();
  return client;
}

/** Runs `sql` inside a savepoint and returns the refusal message; fails the test when the statement is allowed. */
async function refusalOf(client: QueryClient, sql: string): Promise<string> {
  await client.query('SAVEPOINT attempt');
  try {
    await client.query(sql);
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    const { code, message } = error as { code?: string; message: string };
    expect(code).toBe(PERMISSION_DENIED);
    return message;
  }
  throw new Error(`The application role was allowed to run: ${sql}`);
}
