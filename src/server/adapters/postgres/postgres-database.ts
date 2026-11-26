import type pg from 'pg';
import type { Row, TableAccess, Transaction } from '../../shared/unit-of-work';

/** What the stores of this folder send statements through: the pool (committed tables) or one transaction's client. */
export interface Queryable {
  query<Result extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<pg.QueryResult<Result>>;
}

/** The module schemas that hold a `records` table (migration 0005); any other table name lives in `foundation`. */
const RECORD_SCHEMAS: readonly string[] = [
  'personal_data',
  'accounts_and_access_control',
  'sites_and_areas',
  'licensing_assignment_attendance',
  'ticketing',
  'payments',
];
const FALLBACK_SCHEMA = 'foundation';

/** Reachable only through the audit log store, never through TableAccess (ADR-10, ADR-13). */
const AUDIT_LOG_TABLES: readonly string[] = ['audit_log', 'audit_log_head'];

interface RecordRow extends pg.QueryResultRow {
  readonly record: Row;
}

/** Where a table's records live: `<schema>.<table>` goes to that schema's `records`, anything else to `foundation`. */
function locate(table: string): { readonly schema: string; readonly recordTable: string } {
  if (AUDIT_LOG_TABLES.includes(table) || table.startsWith('audit_log.')) {
    throw new Error(`${table} is reachable only through the audit log store`);
  }
  const dot = table.indexOf('.');
  const schema = dot > 0 ? table.slice(0, dot) : '';
  return RECORD_SCHEMAS.includes(schema) ? { schema, recordTable: table.slice(dot + 1) } : { schema: FALLBACK_SCHEMA, recordTable: table };
}

/**
 * TableAccess over PostgreSQL (ADR-21): every record is stored whole, as the `json` text of the object written, under
 * its key, in the `records` table of its schema. A refused insert, replace or remove throws the same message as the
 * in-memory database (deleted, ADR-21) did and leaves the transaction usable.
 */
async function readRecord<Stored extends Row>(through: Queryable, table: string, key: string): Promise<Stored | undefined> {
  const { schema, recordTable } = locate(table);
  const result = await through.query<RecordRow>(`SELECT record FROM ${schema}.records WHERE record_table = $1 AND record_key = $2`, [recordTable, key]);
  return result.rows[0]?.record as Stored | undefined;
}

async function listRecords<Stored extends Row>(through: Queryable, table: string): Promise<readonly Stored[]> {
  const { schema, recordTable } = locate(table);
  const result = await through.query<RecordRow>(`SELECT record FROM ${schema}.records WHERE record_table = $1 ORDER BY position`, [recordTable]);
  return result.rows.map((row) => row.record as Stored);
}

async function insertRecord(through: Queryable, table: string, key: string, row: Row): Promise<void> {
  const { schema, recordTable } = locate(table);
  const result = await through.query(
    `INSERT INTO ${schema}.records (record_table, record_key, record) VALUES ($1, $2, $3::json) ON CONFLICT DO NOTHING`,
    [recordTable, key, JSON.stringify(row)],
  );
  if (result.rowCount === 0) {
    throw new Error(`Table ${table} already holds a row with the key ${key}`);
  }
}

async function replaceRecord(through: Queryable, table: string, key: string, row: Row): Promise<void> {
  const { schema, recordTable } = locate(table);
  const result = await through.query(`UPDATE ${schema}.records SET record = $3::json WHERE record_table = $1 AND record_key = $2`, [
    recordTable,
    key,
    JSON.stringify(row),
  ]);
  if (result.rowCount === 0) {
    throw new Error(`Table ${table} has no row with the key ${key}`);
  }
}

async function removeRecord(through: Queryable, table: string, key: string): Promise<void> {
  const { schema, recordTable } = locate(table);
  const result = await through.query(`DELETE FROM ${schema}.records WHERE record_table = $1 AND record_key = $2`, [recordTable, key]);
  if (result.rowCount === 0) {
    throw new Error(`Table ${table} has no row with the key ${key}`);
  }
}

/**
 * The committed tables, and the factory of transactions. Reads outside a unit of work use `committedPool`;
 * transactions take their client from `transactionPool`, so a handler that reads committed tables while its own
 * transaction holds a client never waits on itself. `created` settles once the database exists: a test database is
 * created while its application is composed, so every statement waits for it (and fails with its error).
 */
export class PostgresDatabase implements TableAccess {
  private readonly created: Promise<void>;
  private closing: Promise<void> | undefined;
  /** Statements on the committed tables, for the adapters' own stores. */
  readonly committed: Queryable;

  constructor(
    private readonly committedPool: pg.Pool,
    private readonly transactionPool: pg.Pool = committedPool,
    created: Promise<void> = Promise.resolve(),
  ) {
    this.created = created;
    // A database that failed to be created reports it to every statement; this handler only stops an unhandled rejection.
    created.catch(() => undefined);
    this.committed = {
      query: async (sql, values) => {
        await this.created;
        return this.committedPool.query(sql, values as unknown[] | undefined);
      },
    };
  }

  read<Stored extends Row>(table: string, key: string): Promise<Stored | undefined> {
    return readRecord(this.committed, table, key);
  }

  list<Stored extends Row>(table: string): Promise<readonly Stored[]> {
    return listRecords(this.committed, table);
  }

  insert(table: string, key: string, row: Row): Promise<void> {
    return insertRecord(this.committed, table, key, row);
  }

  replace(table: string, key: string, row: Row): Promise<void> {
    return replaceRecord(this.committed, table, key, row);
  }

  remove(table: string, key: string): Promise<void> {
    return removeRecord(this.committed, table, key);
  }

  /** A client of its own, for the adapters that run their own short transactions (the rate limiter). */
  async connect(): Promise<pg.PoolClient> {
    await this.created;
    return this.transactionPool.connect();
  }

  begin(): PostgresTransaction {
    return new PostgresTransaction(() => this.connect());
  }

  /** Ends both pools; closing twice is harmless. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      await this.committedPool.end();
      if (this.transactionPool !== this.committedPool) {
        await this.transactionPool.end();
      }
    })();
    return this.closing;
  }
}

type TransactionState = 'open' | 'committed' | 'rolled back';

/**
 * One unit of work over one client. It starts lazily: the client is taken and BEGIN sent with the first statement, so
 * `begin()` stays synchronous as the port requires (ADR-13). Statements run in the order they are handed in.
 * Work handed in without waiting (an outbox insert from a synchronous `publish`) is awaited before COMMIT.
 */
export class PostgresTransaction implements Transaction, Queryable {
  private client: Promise<pg.PoolClient> | undefined;
  private state: TransactionState = 'open';
  private readonly beforeCommit: Promise<unknown>[] = [];
  private readonly onceDone: (() => void)[] = [];

  constructor(private readonly connect: () => Promise<pg.PoolClient>) {}

  async query<Result extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<pg.QueryResult<Result>> {
    const client = await this.connection();
    return client.query<Result>(sql, values as unknown[] | undefined);
  }

  /** Statement work started without waiting; COMMIT waits for it and fails if it failed. */
  awaitBeforeCommit(work: Promise<unknown>): void {
    // The failure is reported by commit(), which awaits the same promise; this handler only stops an unhandled rejection.
    work.catch(() => undefined);
    this.beforeCommit.push(work);
  }

  /** Runs once the transaction has committed or rolled back (an advisory lock flag, for example). */
  whenDone(callback: () => void): void {
    this.onceDone.push(callback);
  }

  async read<Stored extends Row>(table: string, key: string): Promise<Stored | undefined> {
    this.assertOpen('read from');
    return readRecord(this, table, key);
  }

  async list<Stored extends Row>(table: string): Promise<readonly Stored[]> {
    this.assertOpen('list');
    return listRecords(this, table);
  }

  async insert(table: string, key: string, row: Row): Promise<void> {
    this.assertOpen('insert into');
    return insertRecord(this, table, key, row);
  }

  async replace(table: string, key: string, row: Row): Promise<void> {
    this.assertOpen('replace in');
    return replaceRecord(this, table, key, row);
  }

  async remove(table: string, key: string): Promise<void> {
    this.assertOpen('remove from');
    return removeRecord(this, table, key);
  }

  async commit(): Promise<void> {
    this.assertOpen('commit');
    if (this.client === undefined) {
      this.finish('committed');
      return;
    }
    await Promise.all(this.beforeCommit);
    await this.query('COMMIT');
    this.finish('committed');
  }

  async rollback(): Promise<void> {
    this.assertOpen('roll back');
    // A client that never connected has nothing to roll back; the statement that needed it already failed loudly.
    const client = await this.client?.catch(() => undefined);
    if (client !== undefined) {
      await Promise.allSettled(this.beforeCommit);
      await client.query('ROLLBACK');
    }
    this.finish('rolled back');
  }

  private connection(): Promise<pg.PoolClient> {
    if (this.client === undefined) {
      this.client = this.connect().then(async (client) => {
        await client.query('BEGIN');
        return client;
      });
    }
    return this.client;
  }

  private finish(state: TransactionState): void {
    this.state = state;
    // A client that never connected has nothing to release; its failure reached the statement that needed it.
    this.client?.then((client) => client.release()).catch(() => undefined);
    this.onceDone.forEach((callback) => callback());
  }

  private assertOpen(action: string): void {
    if (this.state !== 'open') {
      throw new Error(`Cannot ${action} a transaction that is already ${this.state}`);
    }
  }
}
