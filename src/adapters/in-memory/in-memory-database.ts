import type { UnitOfWork } from '../../shared/unit-of-work';

/**
 * Reading and inserting rows of a named table. Both the database (changes apply at once) and a transaction
 * (changes apply on commit) offer it, so a store can be bound to either.
 */
export interface TableAccess {
  rows<Row>(table: string): readonly Row[];
  insert<Row>(table: string, row: Row): void;
}

/**
 * The stand-in for PostgreSQL in every test. Tables are arrays of plain rows.
 * Transactions stage inserts and apply them on commit; two open transactions do not see each other's staged rows.
 * Warning: unlike PostgreSQL, nothing here locks, so concurrent transactions over the same table are not serialised.
 */
export class InMemoryDatabase implements TableAccess {
  private readonly tables = new Map<string, unknown[]>();

  rows<Row>(table: string): readonly Row[] {
    return this.tableRows<Row>(table);
  }

  insert<Row>(table: string, row: Row): void {
    this.tableRows<Row>(table).push(row);
  }

  replaceWhere<Row>(table: string, matches: (row: Row) => boolean, replacement: (row: Row) => Row): void {
    const rows = this.tableRows<Row>(table);
    rows.forEach((row, index) => {
      if (matches(row)) {
        rows[index] = replacement(row);
      }
    });
  }

  begin(): InMemoryTransaction {
    return new InMemoryTransaction(this);
  }

  private tableRows<Row>(table: string): Row[] {
    const existing = this.tables.get(table);
    if (existing !== undefined) {
      return existing as Row[];
    }
    const created: Row[] = [];
    this.tables.set(table, created);
    return created;
  }
}

type TransactionState = 'open' | 'committed' | 'rolled back';

export class InMemoryTransaction implements TableAccess, UnitOfWork {
  private readonly staged = new Map<string, unknown[]>();
  private state: TransactionState = 'open';

  constructor(private readonly database: InMemoryDatabase) {}

  rows<Row>(table: string): readonly Row[] {
    return [...this.database.rows<Row>(table), ...this.stagedRows<Row>(table)];
  }

  insert<Row>(table: string, row: Row): void {
    this.assertOpen('insert into');
    this.stagedRows<Row>(table).push(row);
  }

  async commit(): Promise<void> {
    this.assertOpen('commit');
    for (const [table, rows] of this.staged) {
      rows.forEach((row) => this.database.insert(table, row));
    }
    this.state = 'committed';
  }

  async rollback(): Promise<void> {
    this.assertOpen('roll back');
    this.staged.clear();
    this.state = 'rolled back';
  }

  private stagedRows<Row>(table: string): Row[] {
    const existing = this.staged.get(table);
    if (existing !== undefined) {
      return existing as Row[];
    }
    const created: Row[] = [];
    this.staged.set(table, created);
    return created;
  }

  private assertOpen(action: string): void {
    if (this.state !== 'open') {
      throw new Error(`Cannot ${action} a transaction that is already ${this.state}`);
    }
  }
}
