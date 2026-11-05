import type { AuditTrail } from '../modules/audit-log/public';
import type { EventPublisher } from '../shared/events/event';
import type { UnitOfWork } from '../shared/unit-of-work';

/** Everything a write needs, all bound to one unit of work: state change, audit entry and events commit together. */
export interface WriteResources {
  readonly transaction: UnitOfWork;
  readonly audit: AuditTrail;
  readonly events: EventPublisher;
}

export interface WriteResourcesFactory {
  begin(): WriteResources;
}
