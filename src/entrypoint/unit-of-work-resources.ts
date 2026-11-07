import type { AuditTrail } from '../modules/audit-log/public';
import type { EventPublisher } from '../shared/events/event';
import type { Transaction } from '../shared/unit-of-work';

/** Everything one audited action needs, all bound to one unit of work: state change, audit entry and events commit together. */
export interface UnitOfWorkResources {
  readonly transaction: Transaction;
  readonly audit: AuditTrail;
  readonly events: EventPublisher;
}

export interface UnitOfWorkResourcesFactory {
  begin(): UnitOfWorkResources;
}
