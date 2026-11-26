import pg from 'pg';
import { pendingMigrations } from './migrate';
import { PostgresDatabase } from './postgres-database';
import { readPostgresUrl, withoutPassword } from './postgres-url';

/** The pool sizes of one server copy: transactions and committed reads draw from separate pools (see PostgresDatabase). */
const TRANSACTION_CONNECTIONS = 10;
const READ_CONNECTIONS = 5;
/** How long start-up waits for PostgreSQL to answer before it gives up and says so. */
const CONNECTION_TIMEOUT_MILLISECONDS = 5_000;

/** The database the server runs on (ADR-21). Connections open when the first statement needs one. */
export function connectToPostgres(connectionString: string): PostgresDatabase {
  const pool = (max: number) => new pg.Pool({ connectionString, max, connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLISECONDS });
  return new PostgresDatabase(pool(READ_CONNECTIONS), pool(TRANSACTION_CONNECTIONS));
}

/**
 * The server's database, checked before anything is served (ADR-21). Start-up stops with a clear message when
 * POSTGRES_URL is missing, when PostgreSQL does not answer, or when a migration of `db/migrations` is not applied yet.
 * There is no fallback to any other storage. The password never appears in a message.
 */
export async function openTheDatabase(environment: NodeJS.ProcessEnv): Promise<PostgresDatabase> {
  const url = readPostgresUrl(environment);
  const database = connectToPostgres(url);
  try {
    await database.committed.query('SELECT 1');
  } catch (error) {
    await database.close();
    throw new Error(`cannot reach PostgreSQL at ${withoutPassword(url)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const missing = await pendingMigrations(database.committed);
  if (missing.length > 0) {
    await database.close();
    throw new Error(`the database at ${withoutPassword(url)} lacks the migrations ${missing.join(', ')}: run npm run db:migrate first`);
  }
  return database;
}
