import { InMemoryAuditLogStore } from '../adapters/in-memory/in-memory-audit-log-store';
import { InMemoryDatabase } from '../adapters/in-memory/in-memory-database';
import { InMemoryOutboxStore } from '../adapters/in-memory/in-memory-outbox-store';
import { InMemoryResponseStore } from '../adapters/in-memory/in-memory-response-store';
import { createHashChainedAuditTrail, operations as auditLogOperations, type AuditTrail } from '../modules/audit-log/public';
import { SystemClock, type Clock } from '../shared/clock';
import type { EventSubscriber } from '../shared/events/event';
import { OutboxDeliveryJob } from '../shared/events/outbox-delivery-job';
import { PermissionTable } from './auth/permission-table';
import { createRequestHandler, type RequestHandler } from './handle-request';
import type { Operation } from '../shared/operation-contract';
import { foundationOperations } from './operations/foundation-operations';
import { OperationRegistry } from './operations/registry';
import type { WriteResourcesFactory } from './write-resources';

export interface InMemoryApplicationOptions {
  readonly tokenSecret: string;
  readonly clock?: Clock;
  /** Test-only operations registered beside the composed ones; the composed set is never replaced. */
  readonly additionalOperations?: readonly Operation[];
  readonly subscribers?: readonly EventSubscriber[];
}

export interface InMemoryApplication {
  readonly handle: RequestHandler;
  readonly database: InMemoryDatabase;
  readonly audit: AuditTrail;
  readonly outbox: InMemoryOutboxStore;
  readonly outboxDelivery: OutboxDeliveryJob;
  readonly permissions: PermissionTable;
  readonly registry: OperationRegistry;
}

/** The composition root for the in-memory stack: construction happens here and nowhere else. */
export function composeInMemoryApplication(options: InMemoryApplicationOptions): InMemoryApplication {
  const clock = options.clock ?? new SystemClock();
  const database = new InMemoryDatabase();
  const outbox = new InMemoryOutboxStore(database, clock);
  const audit = createHashChainedAuditTrail(new InMemoryAuditLogStore(database), clock);
  const operations = [...auditLogOperations({ audit }), ...foundationOperations, ...(options.additionalOperations ?? [])];
  const registry = new OperationRegistry(operations);
  const permissions = new PermissionTable(operations);
  const writeResources: WriteResourcesFactory = {
    begin() {
      const transaction = database.begin();
      return {
        transaction,
        audit: createHashChainedAuditTrail(new InMemoryAuditLogStore(transaction), clock),
        events: outbox.publisherBoundTo(transaction),
      };
    },
  };
  const handle = createRequestHandler({
    registry,
    permissions,
    tokenSecret: options.tokenSecret,
    writeResources,
    responses: new InMemoryResponseStore(),
  });
  return {
    handle,
    database,
    audit,
    outbox,
    outboxDelivery: new OutboxDeliveryJob(outbox, options.subscribers ?? [], clock),
    permissions,
    registry,
  };
}
