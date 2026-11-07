import { InMemoryAuditLogStore } from '../adapters/in-memory/in-memory-audit-log-store';
import { InMemoryDatabase } from '../adapters/in-memory/in-memory-database';
import { InMemoryOutboxStore } from '../adapters/in-memory/in-memory-outbox-store';
import { InMemorySlidingWindowRateLimiter } from '../adapters/in-memory/in-memory-rate-limiter';
import { InMemoryResponseStore } from '../adapters/in-memory/in-memory-response-store';
import {
  createAccountsAndAccessControl,
  createInMemoryAccountsStores,
  type AccountsAndAccessControl,
  type SiteLocator,
} from '../modules/accounts-and-access-control/public';
import { createHashChainedAuditTrail, operations as auditLogOperations, type AuditTrail } from '../modules/audit-log/public';
import { SystemClock, type Clock } from '../shared/clock';
import type { EventSubscriber } from '../shared/events/event';
import { OutboxDeliveryJob } from '../shared/events/outbox-delivery-job';
import type { Operation } from '../shared/operation-contract';
import { EVERYONE_IS_LIVE, type AccessChecks } from './auth/access-checks';
import { PermissionTable } from './auth/permission-table';
import { createRequestHandler, type RequestHandler } from './handle-request';
import { foundationOperations } from './operations/foundation-operations';
import { OperationRegistry } from './operations/registry';
import type { UnitOfWorkResourcesFactory } from './unit-of-work-resources';

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
  /** Who answers live status, bound site and scope in tests. Absent: everyone is live. The server never uses this. */
  readonly accessChecks?: AccessChecks;
  /** Test-only operations registered beside the composed ones. */
  readonly additionalOperations?: readonly Operation[];
  /**
   * Transitional (see QUESTIONS.md): the whole registry instead of the composed one, for tests already on main that
   * build their own list. New tests use `additionalOperations`.
   */
  readonly operations?: readonly Operation[];
  readonly subscribers?: readonly EventSubscriber[];
}

export interface InMemoryApplication {
  readonly handle: RequestHandler;
  readonly database: InMemoryDatabase;
  /** The accounts module as composed, so the operator and the tests can register people and change their status. */
  readonly accounts: AccountsAndAccessControl;
  readonly audit: AuditTrail;
  readonly outbox: InMemoryOutboxStore;
  readonly outboxDelivery: OutboxDeliveryJob;
  readonly permissions: PermissionTable;
  readonly registry: OperationRegistry;
}

/** The in-memory server as `main.ts` runs it: the real accounts module answers live status, bound site and scope. */
export function composeInMemoryServer(options: Pick<InMemoryApplicationOptions, 'tokenSecret' | 'clock'>): InMemoryApplication {
  return compose(options, (accounts) => accounts.authorization);
}

/** The in-memory application for tests: a stand-in answers live status unless the test passes its own checks. */
export function composeInMemoryApplication(options: InMemoryApplicationOptions): InMemoryApplication {
  return compose(options, () => options.accessChecks ?? EVERYONE_IS_LIVE);
}

/** The composition root for the in-memory stack: construction happens here and nowhere else. */
function compose(
  options: InMemoryApplicationOptions,
  chooseAccessChecks: (accounts: AccountsAndAccessControl) => AccessChecks,
): InMemoryApplication {
  const clock = options.clock ?? new SystemClock();
  const database = new InMemoryDatabase();
  const outbox = new InMemoryOutboxStore(database, clock);
  const audit = createHashChainedAuditTrail(new InMemoryAuditLogStore(database.tables), clock);
  const accounts = createAccountsAndAccessControl({ stores: createInMemoryAccountsStores(), siteLocator: NO_SITES_YET });
  const registry = registryFor(options, audit);
  const permissions = new PermissionTable(registry.all());
  const resources: UnitOfWorkResourcesFactory = {
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
    clock,
    database,
    resources,
    accessChecks: chooseAccessChecks(accounts),
    responses: new InMemoryResponseStore(),
    rateLimiter: new InMemorySlidingWindowRateLimiter(clock),
  });
  return {
    handle,
    database,
    accounts,
    audit,
    outbox,
    outboxDelivery: new OutboxDeliveryJob(outbox, options.subscribers ?? [], clock),
    permissions,
    registry,
  };
}

function registryFor(options: InMemoryApplicationOptions, audit: AuditTrail): OperationRegistry {
  if (options.operations !== undefined) {
    return new OperationRegistry(options.operations);
  }
  return composeRegistry({ audit }, options.additionalOperations);
}

/**
 * No site registry implementation exists on main yet, so the accounts module is told that no site or zone is known;
 * every scoped request is then refused as "unknown place" until Lino's registry fills this port (see QUESTIONS.md).
 */
const NO_SITES_YET: SiteLocator = {
  locateSite: async () => undefined,
  locateZone: async () => undefined,
};
