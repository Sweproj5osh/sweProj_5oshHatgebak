import type { AuditEntry } from '../modules/audit-log/public';
import type { EventPublisher } from '../shared/events/event';
import type { Transaction } from '../shared/unit-of-work';

/** Everything one audited action needs, all bound to one unit of work: state change, audit entry and events commit together. */
export interface UnitOfWorkResources {
  readonly transaction: Transaction;
  readonly events: EventPublisher;
  /**
   * The commit step of an audited action: assign the next audit id, chain the entry to the previous one, append it,
   * commit. The factory runs this step for every unit of work through one serial queue per process, so two concurrent
   * writes never read the same "last entry" (integrity, rank 1). Across server copies the PostgreSQL adapter takes the
   * advisory lock named in the audit log's public interface.
   */
  appendAuditEntryAndCommit(entry: AuditEntry): Promise<void>;
}

export interface UnitOfWorkResourcesFactory {
  begin(): UnitOfWorkResources;
}
