import { InMemoryAuditLogStore } from '../adapters/in-memory/in-memory-audit-log-store';
import { InMemoryDatabase } from '../adapters/in-memory/in-memory-database';
import { InMemoryOutboxStore } from '../adapters/in-memory/in-memory-outbox-store';
import { InMemoryResponseStore } from '../adapters/in-memory/in-memory-response-store';
import { createHashChainedAuditTrail, operations as auditLogOperations, type AuditTrail } from '../modules/audit-log/public';
import { SystemClock, type Clock } from '../shared/clock';
import type { EventSubscriber } from '../shared/events/event';
import { OutboxDeliveryJob } from '../shared/events/outbox-delivery-job';
import type { Operation } from '../shared/operation-contract';
import { PermissionTable } from './auth/permission-table';
import { createRequestHandler, type RequestHandler } from './handle-request';
import { foundationOperations } from './operations/foundation-operations';
import { OperationRegistry } from './operations/registry';
import type { WriteResourcesFactory } from './write-resources';

/** What the modules' `operations(dependencies)` exports need. Each owner adds the fields their module needs (P4). */
export interface ModuleDependencies {
  /** The audit trail read outside any transaction. */
  readonly audit: AuditTrail;
}

/**
 * The one list of every operation the server exposes: each module's `operations(dependencies)` in alphabetical order
 * of module, then the foundation's own. An owner adds their module's line in their own pull request (P4). The fitness
 * functions and the tests build the registry through this same function, so they see exactly what the server runs.
 */
export function composeRegistry(dependencies: ModuleDependencies, additionalOperations: readonly Operation[] = []): OperationRegistry {
  return new OperationRegistry([
    ...auditLogOperations(dependencies),
    ...foundationOperations,
    ...additionalOperations,
  ]);
}

/** The composed registry over fresh in-memory dependencies, for the fitness functions that inspect declarations. */
export function composeInMemoryRegistry(): OperationRegistry {
  const database = new InMemoryDatabase();
  return composeRegistry({ audit: createHashChainedAuditTrail(new InMemoryAuditLogStore(database.tables), new SystemClock()) });
}

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
  const audit = createHashChainedAuditTrail(new InMemoryAuditLogStore(database.tables), clock);
  const registry = composeRegistry({ audit }, options.additionalOperations);
  const permissions = new PermissionTable(registry.all());
  const writeResources: WriteResourcesFactory = {
    begin() {
      const transaction = database.begin();
      return {
        transaction,
        audit: createHashChainedAuditTrail(new InMemoryAuditLogStore(transaction.tables), clock),
        events: outbox.publisherBoundTo(transaction.tables),
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
