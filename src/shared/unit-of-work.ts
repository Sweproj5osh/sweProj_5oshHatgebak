/**
 * One unit of work is one transaction: everything staged inside it is committed together or not at all
 * (ADR-06 Rule E, ADR-07). Adapters implement it over their own storage.
 */
export interface UnitOfWork {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
