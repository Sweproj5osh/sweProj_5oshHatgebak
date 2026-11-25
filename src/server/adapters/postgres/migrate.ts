import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { readPostgresUrl } from './postgres-url';

export const MIGRATIONS_FOLDER = path.join('db', 'migrations');

/**
 * Applies, in file-name order, every migration in `db/migrations` that the database has not recorded yet, each in its
 * own transaction, and records it in `foundation.schema_migrations`. A second run applies nothing. Run it as the
 * database owner: `POSTGRES_URL=<owner connection> npm run db:migrate`.
 */
export async function migrate(connectionString: string, folder: string = path.resolve(MIGRATIONS_FOLDER)): Promise<readonly string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS foundation');
    await client.query('CREATE TABLE IF NOT EXISTS foundation.schema_migrations (migration text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Set((await client.query<{ migration: string }>('SELECT migration FROM foundation.schema_migrations')).rows.map((row) => row.migration));
    const pending = (await migrationFiles(folder)).filter((file) => !applied.has(file));
    for (const file of pending) {
      await client.query('BEGIN');
      try {
        await client.query(await readFile(path.join(folder, file), 'utf8'));
        await client.query('INSERT INTO foundation.schema_migrations (migration) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return pending;
  } finally {
    await client.end();
  }
}

/** The migrations a database has not applied yet; start-up refuses to serve while any is missing. */
export async function pendingMigrations(through: pg.Pool, folder: string = path.resolve(MIGRATIONS_FOLDER)): Promise<readonly string[]> {
  const files = await migrationFiles(folder);
  const table = await through.query<{ present: string | null }>("SELECT to_regclass('foundation.schema_migrations') AS present");
  if (table.rows[0]?.present === null) {
    return files;
  }
  const applied = new Set((await through.query<{ migration: string }>('SELECT migration FROM foundation.schema_migrations')).rows.map((row) => row.migration));
  return files.filter((file) => !applied.has(file));
}

async function migrationFiles(folder: string): Promise<string[]> {
  return (await readdir(folder)).filter((file) => file.endsWith('.sql')).sort();
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invokedDirectly) {
  const applied = await migrate(readPostgresUrl(process.env));
  console.log(applied.length === 0 ? 'Database is up to date: nothing to apply' : `Applied ${applied.join(', ')}`);
}
