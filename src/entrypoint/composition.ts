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
import { createFeeCalculator, createPriceList, type FeeCalculator, type PriceList, type PriceListOptions } from '../modules/committee-prices/public';
import {
  operations as ticketingOperations,
  TableTicketStore,
  type CarOwnership,
  type PlateLookup,
  type TicketStore,
  type TicketingSites,
} from '../modules/ticketing/public';
import { SystemClock, type Clock } from '../shared/clock';
import type { EventSubscriber } from '../shared/events/event';
import { OutboxDeliveryJob } from '../shared/events/outbox-delivery-job';
import { KeyedSerialQueue } from '../shared/keyed-serial-queue';
import type { Operation } from '../shared/operation-contract';
import { fail, succeed } from '../shared/result';
import { SerialQueue } from '../shared/serial-queue';
import type { TokenIssuer } from '../shared/token-issuer';
import { EVERYONE_IS_LIVE, type AccessChecks } from './auth/access-checks';
import { PermissionTable } from './auth/permission-table';
import { createTokenIssuer } from './auth/token-issuer';
import { bootstrapFirstChair, type BootstrapOutcome } from './bootstrap';
import { createRequestHandler, type RequestHandler } from './handle-request';
import { foundationOperations } from './operations/foundation-operations';
import { OperationRegistry } from './operations/registry';
import type { UnitOfWorkResourcesFactory } from './unit-of-work-resources';

/** What the modules' `operations(dependencies)` exports need. Each owner adds the fields their module needs (P4). */
export interface ModuleDependencies {
  /** The audit trail read outside any transaction. */
  readonly audit: AuditTrail;
  /** Ticketing: whether a car belongs to a person; Lino's PersonalData fills it (P28 #32). */
  readonly carOwnership: CarOwnership;
  readonly clock: Clock;
  /** Ticketing asks this for every fee and never computes one (Rule C). */
  readonly fees: FeeCalculator;
  /** Ticketing: the plate join for receipts, answered by Lino's PersonalData (A4, P28 #33). */
  readonly plates: PlateLookup;
  /** The committee's dated prices; written only by Approvals through it (B3, P28 #34). */
  readonly prices: PriceList;
  /** Ticketing: the site registry's codes, opening hours and capacity (Lino's Sites & Areas). */
  readonly sites: TicketingSites;
  readonly tickets: TicketStore;
  /** Mints a token at sign-in (Q4); the accounts module's signIn uses it. */
  readonly tokens: TokenIssuer;
}

/**
 * The one list of every operation the server exposes: each module's `operations(dependencies)` in alphabetical order
 * of module, then the foundation's own. An owner adds their module's line in their own pull request (P4). The fitness
 * functions and the tests build the registry through this same function, so they see exactly what the server runs.
 */
export function composeRegistry(dependencies: ModuleDependencies, additionalOperations: readonly Operation[] = []): OperationRegistry {
  return new OperationRegistry([
    ...auditLogOperations(dependencies),
    ...ticketingOperations(dependencies),
    ...foundationOperations,
    ...additionalOperations,
  ]);
}

/** The declaration-reading fitness functions never issue a token; this secret only lets the registry be built. */
const INSPECTION_ONLY_SECRET = 'fitness-inspection-never-signs-a-real-token';

/** The composed registry over fresh in-memory dependencies, for the fitness functions that inspect declarations. */
export function composeInMemoryRegistry(): OperationRegistry {
  const database = new InMemoryDatabase();
  const clock = new SystemClock();
  const audit = createHashChainedAuditTrail(new InMemoryAuditLogStore(database.tables), clock);
  return composeRegistry(moduleDependenciesFor({ audit, clock, tokens: createTokenIssuer(INSPECTION_ONLY_SECRET, clock) }, NO_TICKETING_PORTS_YET));
}

export interface InMemoryApplicationOptions {
  readonly tokenSecret: string;
  readonly clock?: Clock;
  /** Who answers live status, bound site and scope in tests. Absent: everyone is live. The server never uses this. */
  readonly accessChecks?: AccessChecks;
  /** Test-only: the ports a test fills with its own fakes, in place of the stand-ins the test application uses. */
  readonly moduleDependencies?: Partial<ModuleDependencies>;
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
  /** What the modules' operations(dependencies) received, for tests that exercise a port such as the token issuer. */
  readonly moduleDependencies: ModuleDependencies;
  /** Creates the first Chair from the environment once (Q2); main.ts calls it at start-up. */
  bootstrapFirstChair(environment: NodeJS.ProcessEnv): Promise<BootstrapOutcome>;
}

/** The in-memory server as `main.ts` runs it: the real accounts module answers live status, bound site and scope. */
export function composeInMemoryServer(options: Pick<InMemoryApplicationOptions, 'tokenSecret' | 'clock'>): InMemoryApplication {
  return compose(options, { chooseAccessChecks: (accounts) => accounts.authorization, ticketingPorts: NO_TICKETING_PORTS_YET });
}

/** The in-memory application for tests: a stand-in answers live status unless the test passes its own checks. */
export function composeInMemoryApplication(options: InMemoryApplicationOptions): InMemoryApplication {
  return compose(options, { chooseAccessChecks: () => options.accessChecks ?? EVERYONE_IS_LIVE_AND_CLOCKED_IN, ticketingPorts: TICKETING_PORTS_FOR_TESTS });
}

/** What differs between the server and the test application: who answers access checks, and who fills the unfilled ports. */
interface StandIns {
  readonly chooseAccessChecks: (accounts: AccountsAndAccessControl) => AccessChecks;
  readonly ticketingPorts: TicketingPorts;
}

/** The composition root for the in-memory stack: construction happens here and nowhere else. */
function compose(options: InMemoryApplicationOptions, standIns: StandIns): InMemoryApplication {
  const clock = options.clock ?? new SystemClock();
  const database = new InMemoryDatabase();
  const outbox = new InMemoryOutboxStore(database, clock);
  const audit = createHashChainedAuditTrail(new InMemoryAuditLogStore(database.tables), clock);
  const accounts = createAccountsAndAccessControl({ stores: createInMemoryAccountsStores(), siteLocator: NO_SITES_YET });
  const moduleDependencies: ModuleDependencies = {
    ...moduleDependenciesFor({ audit, clock, tokens: createTokenIssuer(options.tokenSecret, clock) }, standIns.ticketingPorts),
    ...options.moduleDependencies,
  };
  const registry = registryFor(options, moduleDependencies);
  const permissions = new PermissionTable(registry.all());
  const chainCommits = new SerialQueue();
  const resources: UnitOfWorkResourcesFactory = {
    begin() {
      const transaction = database.begin();
      const auditInTransaction = createHashChainedAuditTrail(new InMemoryAuditLogStore(transaction.tables), clock);
      return {
        transaction,
        events: outbox.publisherBoundTo(transaction.tables),
        appendAuditEntryAndCommit: (entry) =>
          chainCommits.run(async () => {
            await auditInTransaction.append(entry);
            await transaction.commit();
          }),
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
    accessChecks: standIns.chooseAccessChecks(accounts),
    responses: new InMemoryResponseStore(),
    writeLocks: new KeyedSerialQueue(),
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
    moduleDependencies,
    bootstrapFirstChair: (environment) => bootstrapFirstChair(environment, { accounts, audit, resources }),
  };
}

function registryFor(options: InMemoryApplicationOptions, dependencies: ModuleDependencies): OperationRegistry {
  if (options.operations !== undefined) {
    return new OperationRegistry(options.operations);
  }
  return composeRegistry(dependencies, options.additionalOperations);
}

/** The foundation's own dependencies plus the committee-prices and ticketing wiring over the given ports. */
function moduleDependenciesFor(
  foundation: Pick<ModuleDependencies, 'audit' | 'clock' | 'tokens'>,
  ports: TicketingPorts,
): ModuleDependencies {
  return {
    ...foundation,
    carOwnership: ports.carOwnership,
    fees: createFeeCalculator(),
    plates: ports.plates,
    prices: createPriceList({ isApproved: ports.isApproved }),
    sites: ports.sites,
    tickets: new TableTicketStore(),
  };
}

/**
 * No site registry implementation exists on main yet, so the accounts module is told that no site or zone is known;
 * every scoped request is then refused as "unknown place" until Lino's registry fills this port (see QUESTIONS.md).
 */
const NO_SITES_YET: SiteLocator = {
  locateSite: async () => undefined,
  locateZone: async () => undefined,
};

/** The ports Ticketing and Committee Prices need from modules not on main yet, filled here by the composition root (P26 Q8b). */
interface TicketingPorts {
  readonly sites: TicketingSites;
  readonly carOwnership: CarOwnership;
  readonly plates: PlateLookup;
  /** Amina's `ApprovalDesk.isApproved` once it lands (P28 #34). */
  readonly isApproved: PriceListOptions['isApproved'];
}

/**
 * The server's answers until Lino's registry and PersonalData and Amina's Approvals fill these ports (P27 Q3, P28
 * #31–#34), in the spirit of NO_SITES_YET: no code is genuine, no site is open, no car belongs to anyone, no plate
 * resolves and nothing is approved, so every ticket request is refused rather than guessed. Dated 7 November 2026;
 * transitional until foundation 3 (see QUESTIONS.md).
 */
const NO_TICKETING_PORTS_YET: TicketingPorts = {
  sites: {
    verifyEntryCode: async () => fail('forged'),
    verifyExitCode: async () => fail('forged'),
    isOpenAt: async () => false,
    capacityOf: async () => undefined,
  },
  carOwnership: { carBelongsTo: async () => false },
  plates: { readPlate: async () => fail('not resolvable') },
  isApproved: () => false,
};

/** The spaces every site has in the in-memory test application. */
const STAND_IN_CAPACITY = 5;

/** The site every attendant's session is bound to in the in-memory test application, so assisted sample requests run. */
const STAND_IN_BOUND_SITE = 'site-1';

/**
 * What the in-memory test application answers instead, so that the audit-coverage harness (F5) can run the modules'
 * sample requests (the EVERYONE_IS_LIVE precedent, QUESTIONS.md item 21): a code `entry-<site>` or `exit-<site>` is
 * genuine for that site, every site is open with STAND_IN_CAPACITY spaces, every car belongs to whoever asks, no plate
 * resolves, every approval request counts as approved. A test that needs other answers passes `moduleDependencies`.
 */
const TICKETING_PORTS_FOR_TESTS: TicketingPorts = {
  sites: {
    verifyEntryCode: async (code, siteId) => (code === `entry-${siteId}` ? succeed(siteId) : fail('forged')),
    verifyExitCode: async (code, siteId) => (code === `exit-${siteId}` ? succeed(siteId) : fail('forged')),
    isOpenAt: async () => true,
    capacityOf: async () => STAND_IN_CAPACITY,
  },
  carOwnership: { carBelongsTo: async () => true },
  plates: { readPlate: async () => fail('not resolvable') },
  isApproved: () => true,
};

/** EVERYONE_IS_LIVE with every session bound to STAND_IN_BOUND_SITE, the test application's default access checks. */
const EVERYONE_IS_LIVE_AND_CLOCKED_IN: AccessChecks = { ...EVERYONE_IS_LIVE, boundSite: async () => STAND_IN_BOUND_SITE };
