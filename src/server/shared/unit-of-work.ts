/**
 * One unit of work is one transaction: everything staged inside it is committed together or not at all
 * (ADR-06 Rule E, ADR-07). Adapters implement it over their own storage.
 */
export interface UnitOfWork {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** A stored row: a plain object of data (an interface describes it), keyed by a string the owning module chooses. */
export type Row = object;

/**
 * Reading and changing the rows of a named table inside the unit of work (ADR-13). Module stores read and write
 * through it, so a module's rows, the audit entry and the events commit or roll back together. The audit log is not
 * reachable through it: appends go through the audit log store's own port, and nothing updates or deletes them.
 */
export interface TableAccess {
  read<Stored extends Row>(table: string, key: string): Promise<Stored | undefined>;
  list<Stored extends Row>(table: string): Promise<readonly Stored[]>;
  insert(table: string, key: string, row: Row): Promise<void>;
  replace(table: string, key: string, row: Row): Promise<void>;
  remove(table: string, key: string): Promise<void>;
}

/** What a handler receives: the transaction handle and the tables inside it. */
export type Transaction = UnitOfWork & TableAccess;
