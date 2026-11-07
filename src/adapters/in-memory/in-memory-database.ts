import type { Row, TableAccess, Transaction } from '../../shared/unit-of-work';

export const AUDIT_LOG_TABLE = 'audit_log';

/**
 * Synchronous, unguarded access to keyed rows, for this folder's own adapters (the audit log store and the outbox
 * store). Both the committed tables and a transaction's staged view offer it, so a store can be bound to either.
 */
export interface RowTables {
  find<Stored extends Row>(table: string, key: string): Stored | undefined;
  list<Stored extends Row>(table: string): readonly Stored[];
  entries<Stored extends Row>(table: string): readonly (readonly [key: string, row: Stored])[];
  insert(table: string, key: string, row: Row): void;
  replace(table: string, key: string, row: Row): void;
  remove(table: string, key: string): void;
}

/**
 * The stand-in for PostgreSQL in every test. Tables are maps from key to plain row.
 * Transactions stage inserts, replaces and removes and apply them on commit; two open transactions do not see each
 * other's staged changes. Warning: unlike PostgreSQL, nothing here locks, so concurrent transactions over the same
 * table are not serialised.
 */
export class InMemoryDatabase implements TableAccess {
  /** The committed rows, unguarded: for the audit log store, the outbox store and tests. */
  readonly tables: RowTables = new CommittedTables();
  private readonly guarded = new GuardedTableAccess(this.tables);

  read<Stored extends Row>(table: string, key: string): Promise<Stored | undefined> {
    return this.guarded.read(table, key);
  }

  list<Stored extends Row>(table: string): Promise<readonly Stored[]> {
    return this.guarded.list(table);
  }

  insert(table: string, key: string, row: Row): Promise<void> {
    return this.guarded.insert(table, key, row);
  }

  replace(table: string, key: string, row: Row): Promise<void> {
    return this.guarded.replace(table, key, row);
  }

  remove(table: string, key: string): Promise<void> {
    return this.guarded.remove(table, key);
  }

  begin(): InMemoryTransaction {
    return new InMemoryTransaction(this.tables);
  }
}

type TransactionState = 'open' | 'committed' | 'rolled back';

export class InMemoryTransaction implements Transaction {
  /** The staged view of the tables, unguarded: for the audit log store and the outbox store bound to this transaction. */
  readonly tables: StagedTables;
  private readonly guarded: GuardedTableAccess;
  private state: TransactionState = 'open';

  constructor(committed: RowTables) {
    this.tables = new StagedTables(committed);
    this.guarded = new GuardedTableAccess(this.tables);
  }

  async read<Stored extends Row>(table: string, key: string): Promise<Stored | undefined> {
    this.assertOpen('read from');
    return this.guarded.read(table, key);
  }

  async list<Stored extends Row>(table: string): Promise<readonly Stored[]> {
    this.assertOpen('list');
    return this.guarded.list(table);
  }

  async insert(table: string, key: string, row: Row): Promise<void> {
    this.assertOpen('insert into');
    return this.guarded.insert(table, key, row);
  }

  async replace(table: string, key: string, row: Row): Promise<void> {
    this.assertOpen('replace in');
    return this.guarded.replace(table, key, row);
  }

  async remove(table: string, key: string): Promise<void> {
    this.assertOpen('remove from');
    return this.guarded.remove(table, key);
  }

  async commit(): Promise<void> {
    this.assertOpen('commit');
    this.tables.applyStagedChanges();
    this.state = 'committed';
  }

  async rollback(): Promise<void> {
    this.assertOpen('roll back');
    this.tables.discardStagedChanges();
    this.state = 'rolled back';
  }

  private assertOpen(action: string): void {
    if (this.state !== 'open') {
      throw new Error(`Cannot ${action} a transaction that is already ${this.state}`);
    }
  }
}

/** The module-facing view: asynchronous like the PostgreSQL adapter will be, and blind to the audit log. */
class GuardedTableAccess implements TableAccess {
  constructor(private readonly tables: RowTables) {}

  async read<Stored extends Row>(table: string, key: string): Promise<Stored | undefined> {
    return this.reachable(table).find<Stored>(table, key);
  }

  async list<Stored extends Row>(table: string): Promise<readonly Stored[]> {
    return this.reachable(table).list<Stored>(table);
  }

  async insert(table: string, key: string, row: Row): Promise<void> {
    this.reachable(table).insert(table, key, row);
  }

  async replace(table: string, key: string, row: Row): Promise<void> {
    this.reachable(table).replace(table, key, row);
  }

  async remove(table: string, key: string): Promise<void> {
    this.reachable(table).remove(table, key);
  }

  private reachable(table: string): RowTables {
    if (table === AUDIT_LOG_TABLE) {
      throw new Error(`${AUDIT_LOG_TABLE} is reachable only through the audit log store`);
    }
    return this.tables;
  }
}

class CommittedTables implements RowTables {
  private readonly tables = new Map<string, Map<string, Row>>();

  find<Stored extends Row>(table: string, key: string): Stored | undefined {
    return this.rows<Stored>(table).get(key);
  }

  list<Stored extends Row>(table: string): readonly Stored[] {
    return [...this.rows<Stored>(table).values()];
  }

  entries<Stored extends Row>(table: string): readonly (readonly [key: string, row: Stored])[] {
    return [...this.rows<Stored>(table).entries()];
  }

  insert(table: string, key: string, row: Row): void {
    const rows = this.rows(table);
    if (rows.has(key)) {
      throw new Error(`Table ${table} already holds a row with the key ${key}`);
    }
    rows.set(key, row);
  }

  replace(table: string, key: string, row: Row): void {
    this.existing(table, key).set(key, row);
  }

  remove(table: string, key: string): void {
    this.existing(table, key).delete(key);
  }

  private existing(table: string, key: string): Map<string, Row> {
    const rows = this.rows(table);
    if (!rows.has(key)) {
      throw new Error(`Table ${table} has no row with the key ${key}`);
    }
    return rows;
  }

  /** One cast, here, stands in for the typed rows a real database driver would return. */
  private rows<Stored extends Row>(table: string): Map<string, Stored> {
    const existing = this.tables.get(table);
    if (existing !== undefined) {
      return existing as Map<string, Stored>;
    }
    const created = new Map<string, Row>();
    this.tables.set(table, created);
    return created as Map<string, Stored>;
  }
}

/** A row staged for removal; a staged row is otherwise the row itself. */
const REMOVED = Symbol('removed');
type StagedRow = Row | typeof REMOVED;

/** The committed tables with this transaction's changes laid over them. */
class StagedTables implements RowTables {
  private readonly staged = new Map<string, Map<string, StagedRow>>();

  constructor(private readonly committed: RowTables) {}

  find<Stored extends Row>(table: string, key: string): Stored | undefined {
    const change = this.changes(table).get(key);
    if (change === undefined) {
      return this.committed.find<Stored>(table, key);
    }
    return change === REMOVED ? undefined : (change as Stored);
  }

  list<Stored extends Row>(table: string): readonly Stored[] {
    return this.entries<Stored>(table).map(([, row]) => row);
  }

  entries<Stored extends Row>(table: string): readonly (readonly [key: string, row: Stored])[] {
    const changes = this.changes(table);
    const kept = this.committed.entries<Stored>(table).filter(([key]) => !changes.has(key));
    const changed = [...changes.entries()].filter((entry): entry is [string, Stored] => entry[1] !== REMOVED);
    return [...kept, ...changed];
  }

  insert(table: string, key: string, row: Row): void {
    if (this.find(table, key) !== undefined) {
      throw new Error(`Table ${table} already holds a row with the key ${key}`);
    }
    this.changes(table).set(key, row);
  }

  replace(table: string, key: string, row: Row): void {
    this.assertPresent(table, key);
    this.changes(table).set(key, row);
  }

  remove(table: string, key: string): void {
    this.assertPresent(table, key);
    this.changes(table).set(key, REMOVED);
  }

  applyStagedChanges(): void {
    for (const [table, changes] of this.staged) {
      for (const [key, change] of changes) {
        this.applyOne(table, key, change);
      }
    }
    this.staged.clear();
  }

  discardStagedChanges(): void {
    this.staged.clear();
  }

  private applyOne(table: string, key: string, change: StagedRow): void {
    const committedRow = this.committed.find(table, key);
    if (change === REMOVED) {
      this.committed.remove(table, key);
    } else if (committedRow === undefined) {
      this.committed.insert(table, key, change);
    } else {
      this.committed.replace(table, key, change);
    }
  }

  private assertPresent(table: string, key: string): void {
    if (this.find(table, key) === undefined) {
      throw new Error(`Table ${table} has no row with the key ${key}`);
    }
  }

  private changes(table: string): Map<string, StagedRow> {
    const existing = this.staged.get(table);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, StagedRow>();
    this.staged.set(table, created);
    return created;
  }
}

