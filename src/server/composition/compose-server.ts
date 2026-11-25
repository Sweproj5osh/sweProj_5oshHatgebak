import pg from 'pg';
import { PostgresAuditLogStore } from '../adapters/postgres/postgres-audit-log-store';
import { PostgresDatabase } from '../adapters/postgres/postgres-database';
import { PostgresOutboxStore } from '../adapters/postgres/postgres-outbox-store';
import { PostgresSlidingWindowRateLimiter } from '../adapters/postgres/postgres-rate-limiter';
import { PostgresResponseStore } from '../adapters/postgres/postgres-response-store';
import { PostgresTicketStore } from '../adapters/postgres/postgres-ticket-store';
import {
  createAccountsAndAccessControl,
  createAccountsStores,
  operations as accountsOperations,
  RecordingSignInCodeSender,
  type AccountsAndAccessControl,
  type CarPresence,
} from '../modules/identity-and-registry/accounts-and-access-control/index';
import { createHashChainedAuditTrail, operations as auditLogOperations, type AuditTrail } from '../modules/foundation/audit-log/index';
import { createFeeCalculator, createPriceList, type FeeCalculator, type PriceList, type PriceListOptions } from '../modules/parking-and-prices/committee-prices/index';
import {
  createLicensingAssignmentAttendance,
  createLicensingStores,
  operations as licensingOperations,
  type ApprovalVerifier,
  type LicensingAssignmentAttendance,
} from '../modules/identity-and-registry/licensing-assignment-attendance/index';
import {
  createSiteLocator,
  createSiteRegistry,
  createSitesStores,
  operations as sitesOperations,
  type FreeSpaceSource,
  type PriceSource,
  type SiteRegistry,
} from '../modules/identity-and-registry/sites-and-areas/index';
import {
  operations as ticketingOperations,
  type CarOwnership,
  type PlateLookup,
  type TicketStore,
  type TicketingSites,
} from '../modules/parking-and-prices/ticketing/index';
import { SystemClock, type Clock } from '../shared/clock';
import type { EventSubscriber } from '../shared/events/event';
import { OutboxDeliveryJob } from '../shared/events/outbox-delivery-job';
import { KeyedSerialQueue } from '../shared/keyed-serial-queue';
import type { Operation } from '../shared/operation-contract';
import { succeed } from '../shared/result';
import { SerialQueue } from '../shared/serial-queue';
import type { TokenIssuer } from '../shared/token-issuer';
import type { TableAccess } from '../shared/unit-of-work';
import type { AccessChecks } from '../http/auth/access-checks';
import { PermissionTable } from '../http/auth/permission-table';
import { createTokenIssuer } from '../http/auth/token-issuer';
import { bootstrapFirstChair, type BootstrapOutcome } from './bootstrap';
import { createRequestHandler, type RequestHandler } from '../http/handle-request';
import { foundationOperations } from './foundation-operations';
import { OperationRegistry } from '../http/registry';
import type { UnitOfWorkResourcesFactory } from '../http/unit-of-work-resources';

/** What the modules' `operations(dependencies)` exports need. Each owner adds the fields their module needs (P4). */
export interface ModuleDependencies {
  /** Lino's accounts and access control module as composed (Area 2). */
  readonly accounts: AccountsAndAccessControl;
  /** The audit trail read outside any transaction. */
  readonly audit: AuditTrail;
  /** Ticketing: whether a car belongs to a person; Lino's PersonalData fills it (P28 #32). */
  readonly carOwnership: CarOwnership;
  readonly clock: Clock;
  /** Ticketing asks this for every fee and never computes one (Rule C). */
  readonly fees: FeeCalculator;
  /** Lino's licensing, assignment and attendance module as composed (Area 2). */
  readonly licensing: LicensingAssignmentAttendance;
  /** Ticketing: the plate join for receipts, answered by Lino's PersonalData (A4, P28 #33). */
  readonly plates: PlateLookup;
  /** The committee's dated prices; written only by Approvals through it (B3, P28 #34). */
  readonly prices: PriceList;
  /** Keys the stored hash of every sign-in code (P23); the sign-in sample of the F5 harness seeds a code hashed with it. */
  readonly signInCodeSecret: string;
  /** Signs the site entry and exit codes; the clock-in and clock-out samples of the F5 harness carry a code signed with it. */
  readonly siteCodeSecret: string;
  /** Lino's site registry as composed (Area 2). */
  readonly siteRegistry: SiteRegistry;
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
    ...accountsOperations(dependencies),
    ...auditLogOperations(dependencies),
    ...licensingOperations(dependencies),
    ...sitesOperations(dependencies),
    ...ticketingOperations(dependencies),
    ...foundationOperations,
    ...additionalOperations,
  ]);
}

/** The declaration-reading fitness functions never issue a token; this secret only lets the registry be built. */
const INSPECTION_ONLY_SECRET = 'fitness-inspection-never-signs-a-real-token';

/**
 * The composed registry, for the fitness functions that read declarations only. Its database is a pool that never
 * connects: building the registry runs no statement, so the fitness functions need no database.
 */
export function composeDeclaredRegistry(): OperationRegistry {
  const database = new PostgresDatabase(new pg.Pool({ max: 1 }));
  const clock = new SystemClock();
  const audit = createHashChainedAuditTrail(new PostgresAuditLogStore(database.committed), clock);
  const tokens = createTokenIssuer(INSPECTION_ONLY_SECRET, clock);
  const tickets = new PostgresTicketStore();
  const area2 = composeArea2({
    database,
    clock,
    tokens,
    carPresence: carPresenceFrom({ store: tickets, database, clock }),
    signInCodeSecret: INSPECTION_ONLY_SECRET,
    siteCodeSecret: INSPECTION_ONLY_SECRET,
  });
  return composeRegistry(moduleDependenciesFor({ audit, clock, tokens }, area2, ticketingPortsFrom(area2), tickets));
}

export interface ApplicationOptions {
  /** The PostgreSQL database the application runs on (ADR-21); there is no other storage. */
  readonly database: PostgresDatabase;
  readonly tokenSecret: string;
  /**
   * The secret that signs site codes (`SITE_CODE_SECRET`) and the one that keys the stored sign-in code hashes. Absent,
   * the token secret keys them too: the tests have one secret to carry. main.ts passes the site one.
   */
  readonly siteCodeSecret?: string;
  readonly signInCodeSecret?: string;
  readonly clock?: Clock;
  /** Who answers live status, bound site and scope in tests. Absent: everyone is live. The server never uses this. */
  readonly accessChecks?: AccessChecks;
  /** Test-only: the ports a test fills with its own fakes, in place of the stand-ins the test application uses. */
  readonly moduleDependencies?: Partial<ModuleDependencies>;
  /** Test-only operations registered beside the composed ones. */
  readonly additionalOperations?: readonly Operation[];
  /**
   * Transitional (see docs/team/QUESTIONS.md): the whole registry instead of the composed one, for tests already on main that
   * build their own list. New tests use `additionalOperations`.
   */
  readonly operations?: readonly Operation[];
  readonly subscribers?: readonly EventSubscriber[];
}

export interface ComposedApplication {
  readonly handle: RequestHandler;
  readonly database: PostgresDatabase;
  /** The accounts module as composed, so the operator and the tests can register people and change their status. */
  readonly accounts: AccountsAndAccessControl;
  /** Where the sign-in codes end up (no messaging provider is chosen yet, Rule B): tests read them here. */
  readonly signInCodes: RecordingSignInCodeSender;
  readonly audit: AuditTrail;
  readonly outbox: PostgresOutboxStore;
  readonly outboxDelivery: OutboxDeliveryJob;
  readonly permissions: PermissionTable;
  readonly registry: OperationRegistry;
  /** What the modules' operations(dependencies) received, for tests that exercise a port such as the token issuer. */
  readonly moduleDependencies: ModuleDependencies;
  /** Creates the first Chair from the environment once (Q2); main.ts calls it at start-up. */
  bootstrapFirstChair(environment: NodeJS.ProcessEnv): Promise<BootstrapOutcome>;
}

/**
 * The server as `main.ts` runs it: the real accounts module answers live status, bound site and scope, and Area 2's
 * modules fill ticketing's site, car-ownership and plate ports (P26 Q8b, P27 Q3, P28 #32–#33).
 */
export function composeServer(
  options: Pick<ApplicationOptions, 'database' | 'tokenSecret' | 'siteCodeSecret' | 'signInCodeSecret' | 'clock'>,
): ComposedApplication {
  return compose(options, {
    chooseAccessChecks: (accounts) => accounts.authorization,
    chooseTicketingPorts: ticketingPortsFrom,
    chooseCarPresence: (tickets) => carPresenceFrom(tickets),
  });
}

/** What differs between the server and the test application: who answers access checks, ticketing's ports and car presence. */
export interface StandIns {
  readonly chooseAccessChecks: (accounts: AccountsAndAccessControl) => AccessChecks;
  readonly chooseTicketingPorts: (area2: Area2Modules) => TicketingPorts;
  readonly chooseCarPresence: (tickets: TicketPresenceSource) => CarPresence;
}

/** What the car-presence adapter needs from ticketing: its store over the committed tables and the server clock. */
interface TicketPresenceSource {
  readonly store: TicketStore;
  readonly database: TableAccess;
  readonly clock: Clock;
}

/** The composition root: construction happens here and nowhere else (test-support passes its stand-ins). */
export function compose(options: ApplicationOptions, standIns: StandIns): ComposedApplication {
  const clock = options.clock ?? new SystemClock();
  const database = options.database;
  const outbox = new PostgresOutboxStore(database.committed, clock);
  const audit = createHashChainedAuditTrail(new PostgresAuditLogStore(database.committed), clock);
  const tokens = createTokenIssuer(options.tokenSecret, clock);
  const tickets = new PostgresTicketStore();
  const area2 = composeArea2({
    database,
    clock,
    tokens,
    carPresence: standIns.chooseCarPresence({ store: tickets, database, clock }),
    signInCodeSecret: options.signInCodeSecret ?? options.tokenSecret,
    siteCodeSecret: options.siteCodeSecret ?? options.tokenSecret,
  });
  const { accounts, signInCodes } = area2;
  const moduleDependencies: ModuleDependencies = {
    ...moduleDependenciesFor({ audit, clock, tokens }, area2, standIns.chooseTicketingPorts(area2), tickets),
    ...options.moduleDependencies,
  };
  const registry = registryFor(options, moduleDependencies);
  const permissions = new PermissionTable(registry.all());
  const chainCommits = new SerialQueue();
  const resources: UnitOfWorkResourcesFactory = {
    begin() {
      const transaction = database.begin();
      const auditInTransaction = createHashChainedAuditTrail(new PostgresAuditLogStore(transaction), clock);
      return {
        transaction,
        events: outbox.publisherBoundTo(transaction),
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
    responses: new PostgresResponseStore(database.committed, clock),
    writeLocks: new KeyedSerialQueue(),
    rateLimiter: new PostgresSlidingWindowRateLimiter(database, clock),
  });
  return {
    handle,
    database,
    accounts,
    signInCodes,
    audit,
    outbox,
    outboxDelivery: new OutboxDeliveryJob(outbox, options.subscribers ?? [], clock),
    permissions,
    registry,
    moduleDependencies,
    bootstrapFirstChair: (environment) => bootstrapFirstChair(environment, { accounts, audit, resources }),
  };
}

function registryFor(options: ApplicationOptions, dependencies: ModuleDependencies): OperationRegistry {
  if (options.operations !== undefined) {
    return new OperationRegistry(options.operations);
  }
  return composeRegistry(dependencies, options.additionalOperations);
}

/** The foundation's own dependencies plus Area 2's modules and the committee-prices and ticketing wiring over the given ports. */
function moduleDependenciesFor(
  foundation: Pick<ModuleDependencies, 'audit' | 'clock' | 'tokens'>,
  area2: Area2Modules,
  ports: TicketingPorts,
  tickets: TicketStore,
): ModuleDependencies {
  return {
    ...foundation,
    accounts: area2.accounts,
    carOwnership: ports.carOwnership,
    fees: createFeeCalculator(),
    licensing: area2.licensing,
    plates: ports.plates,
    prices: createPriceList({ isApproved: ports.isApproved }),
    signInCodeSecret: area2.signInCodeSecret,
    siteCodeSecret: area2.siteCodeSecret,
    siteRegistry: area2.siteRegistry,
    sites: ports.sites,
    tickets,
  };
}

interface Area2Construction {
  readonly database: TableAccess;
  readonly clock: Clock;
  readonly tokens: TokenIssuer;
  readonly carPresence: CarPresence;
  readonly signInCodeSecret: string;
  readonly siteCodeSecret: string;
}

interface Area2Modules extends Pick<Area2Construction, 'signInCodeSecret' | 'siteCodeSecret'> {
  readonly accounts: AccountsAndAccessControl;
  readonly siteRegistry: SiteRegistry;
  readonly licensing: LicensingAssignmentAttendance;
  readonly signInCodes: RecordingSignInCodeSender;
}

/**
 * Area 2's three modules over one database, wired the way their ports ask (P26 Q8, P27 Q3): access control gets its
 * SiteLocator from the site registry's tables, the registry gets Authorization, licensing gets both.
 */
function composeArea2({ database, clock, tokens, carPresence, signInCodeSecret, siteCodeSecret }: Area2Construction): Area2Modules {
  const sitesStores = createSitesStores();
  const signInCodes = new RecordingSignInCodeSender();
  const accounts = createAccountsAndAccessControl({
    database,
    stores: createAccountsStores(),
    siteLocator: createSiteLocator(database, sitesStores),
    carPresence,
    signInCodeSender: signInCodes,
    tokenIssuer: tokens,
    signInCodeSecret,
    clock,
  });
  const siteRegistry = createSiteRegistry({
    database,
    stores: sitesStores,
    authorization: accounts.authorization,
    siteCodeSecret,
    freeSpaces: TICKET_COUNTS_NOT_WIRED_YET,
    prices: PRICE_LIST_NOT_WIRED_YET,
    clock,
  });
  const licensing = createLicensingAssignmentAttendance({
    database,
    stores: createLicensingStores(),
    authorization: accounts.authorization,
    accessFacts: accounts.accessFacts,
    registry: siteRegistry,
    approvals: APPROVALS_NOT_COMPOSED_YET,
    clock,
  });
  return { accounts, siteRegistry, licensing, signInCodes, signInCodeSecret, siteCodeSecret };
}

/** The ports Ticketing and Committee Prices need from other modules, filled here by the composition root (P26 Q8b). */
export interface TicketingPorts {
  readonly sites: TicketingSites;
  readonly carOwnership: CarOwnership;
  readonly plates: PlateLookup;
  /** Amina's `ApprovalDesk.isApproved` once it lands (P28 #34). */
  readonly isApproved: PriceListOptions['isApproved'];
}

/**
 * The server's ports, answered by Area 2's modules (P27 Q3, P28 #32–#33): the registry verifies codes, hours and
 * capacity; PersonalData answers whose car it is and the plate for the receipt. Approval stays "nothing is approved"
 * until Amina's desk is composed (P28 #34; transitional, see docs/team/QUESTIONS.md).
 */
function ticketingPortsFrom(area2: Area2Modules): TicketingPorts {
  return {
    sites: area2.siteRegistry,
    carOwnership: area2.accounts.personalData,
    plates: {
      readPlate: async (request) => {
        const served = await area2.accounts.personalData.readPlate(request);
        return served.ok ? succeed(served.value.plate) : served;
      },
    },
    isApproved: () => false,
  };
}

/** How long after its ticket closed a car still counts as seen at the site, for the attendant's cash list and the inspector's look-up. */
const CAR_SEEN_AT_SITE_HOURS_AFTER_CLOSE = 24;

/**
 * Ticketing's word on where a car was seen (the server's CarPresence): an open ticket at the site, or one closed there
 * within the last CAR_SEEN_AT_SITE_HOURS_AFTER_CLOSE hours. Read from the committed tables, never from a stand-in.
 */
function carPresenceFrom({ store, database, clock }: TicketPresenceSource): CarPresence {
  return {
    carSeenAt: async (carRef, siteId) => {
      const now = clock.now();
      const since = new Date(now.getTime() - CAR_SEEN_AT_SITE_HOURS_AFTER_CLOSE * 60 * 60 * 1000);
      const [open, lately] = await Promise.all([store.listOpenAt(database, siteId), store.listClosedAt(database, siteId, since, now)]);
      return [...open, ...lately].some((ticket) => ticket.carRef === carRef);
    },
  };
}

/**
 * Transitional (docs/team/QUESTIONS.md item 17): the registry's free-space count and first-hour fee come from Karim's ticket
 * counts and price list through two ports (P26 Q8b) that this file does not fill yet, so the map shows an unknown band
 * and no fee for every site, which the registry treats as "the source did not answer" (ADR-09).
 */
const TICKET_COUNTS_NOT_WIRED_YET: FreeSpaceSource = {
  freeSpaces: async () => {
    throw new Error('the free-space count is not wired to ticketing yet');
  },
};

const PRICE_LIST_NOT_WIRED_YET: PriceSource = {
  firstHourFee: async () => {
    throw new Error('the first-hour fee is not wired to the price list yet');
  },
};

/** Transitional: until Amina's ApprovalDesk is composed, no licence change is approved, so none is applied (P24). */
const APPROVALS_NOT_COMPOSED_YET: ApprovalVerifier = {
  isApproved: async () => false,
};
