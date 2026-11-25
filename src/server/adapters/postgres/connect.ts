import pg from 'pg';
import { PostgresDatabase } from './postgres-database';

/** The pool sizes of one server copy: transactions and committed reads draw from separate pools (see PostgresDatabase). */
const TRANSACTION_CONNECTIONS = 10;
const READ_CONNECTIONS = 5;

/** The database the server runs on, from POSTGRES_URL (ADR-21). Connections open when the first statement needs one. */
export function connectToPostgres(connectionString: string): PostgresDatabase {
  return new PostgresDatabase(
    new pg.Pool({ connectionString, max: READ_CONNECTIONS }),
    new pg.Pool({ connectionString, max: TRANSACTION_CONNECTIONS }),
  );
}
