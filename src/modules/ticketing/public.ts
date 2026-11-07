/**
 * Ticketing — owner: Karim (Teammate B, Area 3). Must-stay-on set.
 * Open and close by scan, assisted tickets, one open ticket per car, no ticket when full, exit time frozen by the
 * server. Needs the site registry, the fee calculator and price list, car ownership and the plate lookup, all through
 * narrow ports the composition root fills (Q12a: not Authorization or LicenceStatus; Rule D).
 */
import type { Operation } from '../../shared/operation-contract';
import type { FeeCalculator, PriceList } from '../committee-prices/public';
import type { Clock } from '../../shared/clock';
import type { PersonId, SiteId, TicketId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { Result } from '../../shared/result';
import type { TableAccess, Transaction } from '../../shared/unit-of-work';
import { createCloseTicketOperation } from './internal/close-ticket-operation';
import { createOpenTicketOperation } from './internal/open-ticket-operation';
import type { TicketStore } from './internal/ticket-store';
import { createAssistedTicketOperations } from './internal/assisted-ticket-operations';
import { openSampleTicket } from './internal/sample-rows';
import { createTicketClosingService } from './internal/ticket-closing';
import { createReadOperations } from './internal/reading-operations';
import { createTicketCountsService } from './internal/ticket-counts';
import { createTicketReadingService } from './internal/ticket-reading';
import { createTicketPaymentStatusService } from './internal/ticket-payment-status';
import { createTicketOpeningService } from './internal/ticket-opening';

export { TableTicketStore } from './internal/table-ticket-store';
export type { TicketStore } from './internal/ticket-store';
export { PLATE_UNAVAILABLE, TicketReadRefusal } from './internal/ticket-reading';

/** The reference of one car in the personal-data store. A ticket holds this, never the plate. */
export type CarReference = string;

export type TicketState = 'open' | 'closed';
export type PaymentStatus = 'unpaid' | 'paid' | 'disputed' | 'waived';

export interface Ticket {
  readonly ticketId: TicketId;
  readonly siteId: SiteId;
  readonly driverRef: PersonId;
  readonly carRef: CarReference;
  readonly state: TicketState;
  readonly paymentStatus: PaymentStatus;
  readonly openedAt: string;
  readonly closedAt?: string;
  readonly fee?: number;
  /** What the fee calculator could not check when the ticket closed (a failed resident or free-period lookup); absent when every check answered. */
  readonly feeWarnings?: readonly string[];
  readonly assisted: boolean;
}

export type OpenRefusal =
  | 'site closed'
  | 'car already parked'
  | 'site full'
  | 'forged code'
  | 'wrong site'
  | 'attendant not clocked in at this site'
  | 'car not registered to this driver';
export type CloseRefusal =
  | 'no open ticket'
  | 'forged code'
  | 'wrong site'
  | 'exit before entry'
  | 'no price known'
  | 'not an assisted ticket'
  | 'attendant not clocked in at this site'
  | 'car does not match';

export interface OpenTicketCommand {
  readonly requestId: RequestId;
  readonly driverRef: PersonId;
  readonly carRef: CarReference;
  readonly siteId: SiteId;
  readonly entryCode: string;
}

/**
 * The attendant as the entry point proves them (P26 Q4, P28 #32): the person in the token and the site their clock-in
 * bound the session to, read fresh on every request. Ticketing compares that site with the request's site and asks
 * nobody else (Rule D: no port into the may-fail licensing module).
 */
export interface ClockedInAttendant {
  readonly attendantId: PersonId;
  /** Absent when the attendant has not clocked in anywhere. */
  readonly boundSiteId?: SiteId;
}

/**
 * The writes. Every method takes the caller's unit of work first (ADR-13, P1): the ticket row, the caller's own rows,
 * the audit entry and the events commit or roll back together. A write handler passes `context.transaction`; another
 * module (payments marking a ticket paid, approvals applying a waiver) passes the transaction of its own write.
 */
export interface TicketDesk {
  openTicket(unitOfWork: Transaction, command: OpenTicketCommand): Promise<Result<Ticket, OpenRefusal>>;
  openAssistedTicket(unitOfWork: Transaction, command: OpenTicketCommand, attendant: ClockedInAttendant): Promise<Result<Ticket, OpenRefusal>>;
  closeTicket(unitOfWork: Transaction, requestId: RequestId, ticketId: TicketId, exitCode: string): Promise<Result<Ticket, CloseRefusal>>;
  changePaymentStatus(unitOfWork: Transaction, requestId: RequestId, ticketId: TicketId, to: PaymentStatus): Promise<Result<Ticket, string>>;
  /**
   * Closes every ticket at the site open for `maximumHours` or longer (a driver who never scanned out), at the server's
   * now and at the price in force when it opened, capped as any stay is. The caller (the scheduler) owns the number of
   * hours. A ticket that cannot be closed stays open and is named with its reason, never dropped silently.
   */
  closeStaleTickets(unitOfWork: Transaction, siteId: SiteId, maximumHours: number): Promise<StaleTicketSweep>;
}

export interface StaleTicketSweep {
  readonly closed: readonly TicketId[];
  readonly leftOpen: readonly { readonly ticketId: TicketId; readonly reason: CloseRefusal }[];
}

/** One closed ticket as the money check reads it (P28 #36): what was charged, whether it was paid, and who opened it. */
export interface ClosedTicketSummary {
  readonly ticketId: TicketId;
  readonly closedAt: string;
  readonly fee: number;
  readonly paymentStatus: PaymentStatus;
  readonly assisted: boolean;
}

export interface Receipt {
  readonly ticketId: TicketId;
  readonly siteId: SiteId;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly hours: number;
  readonly fee: number;
  /** The plate from the logged join, or PLATE_UNAVAILABLE when the identity area cannot or will not give it. */
  readonly plate: string;
}

/**
 * The reads. Every method takes the tables to read first: a plain read passes the committed tables, a logged read or a
 * write passes its unit of work (`ReadContext.database`, `WriteContext.transaction`).
 */
export interface TicketQuery {
  ticketStatus(tables: TableAccess, ticketId: TicketId): Promise<Ticket>;
  ticketHistory(tables: TableAccess, driverRef: PersonId): Promise<readonly Ticket[]>;
  freeSpaces(tables: TableAccess, siteId: SiteId): Promise<number>;
  /** Assisted tickets opened at the site in the given Cairo calendar month (Africa/Cairo), open or closed. */
  assistedTicketCount(tables: TableAccess, siteId: SiteId, year: number, month: number): Promise<number>;
  receipt(tables: TableAccess, ticketId: TicketId, reader: PersonId): Promise<Receipt>;
  /** The sites a driver parks at, most often first; equally often, the most recently used first. */
  frequentSites(tables: TableAccess, driverRef: PersonId): Promise<readonly SiteId[]>;
  /** The tickets at a site closed from `from` (inclusive) to `to` (exclusive), for the cash reconciliation (P28 #36). */
  closedTicketsBetween(tables: TableAccess, siteId: SiteId, from: Date, to: Date): Promise<readonly ClosedTicketSummary[]>;
}

/** Why the site registry refused a scanned code. An exit code shown at the entrance is "wrong kind". */
export type SiteCodeProblem = 'forged' | 'wrong site' | 'wrong kind';

/**
 * What opening a ticket asks of the site registry. A narrow port, so this module never imports Sites & Areas; the
 * registry's own methods have these shapes, and the composition root passes it in.
 */
export interface TicketingSites {
  verifyEntryCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeProblem>>;
  verifyExitCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeProblem>>;
  isOpenAt(siteId: SiteId, moment: Date): Promise<boolean>;
  capacityOf(siteId: SiteId): Promise<number | undefined>;
}

export interface TicketOpeningDependencies {
  readonly sites: TicketingSites;
  /** A driver opens a ticket only for a car registered to them (integrity, rank 1). */
  readonly carOwnership: CarOwnership;
  readonly store: TicketStore;
  readonly clock: Clock;
  /** Only tests replace this. */
  readonly newTicketId?: () => TicketId;
}

export type TicketOpening = Pick<TicketDesk, 'openTicket' | 'openAssistedTicket'>;

/** Tasks B5 to B7: open a ticket by scan, never above capacity, and the same request id answers the same ticket. */
export function createTicketOpening(dependencies: TicketOpeningDependencies): TicketOpening {
  return createTicketOpeningService(dependencies);
}

export interface TicketClosingDependencies {
  readonly sites: Pick<TicketingSites, 'verifyExitCode'>;
  readonly store: TicketStore;
  readonly clock: Clock;
  /** The price in force at the moment the ticket opened (FR4.3). */
  readonly prices: Pick<PriceList, 'versionValidAt'>;
  /** Rule C: the only place a fee is computed. */
  readonly fees: Pick<FeeCalculator, 'computeFeeForCar'>;
}

/** Closing an assisted ticket also names the attendant and the car seen at the exit, which must match the ticket's. */
export interface AssistedClosing {
  closeAssistedTicket(
    unitOfWork: Transaction,
    requestId: RequestId,
    ticketId: TicketId,
    exitCode: string,
    attendant: ClockedInAttendant,
    carRef: CarReference,
  ): Promise<Result<Ticket, CloseRefusal>>;
}

export type TicketClosing = Pick<TicketDesk, 'closeTicket' | 'closeStaleTickets'> & AssistedClosing;

/** Task B8: close a ticket by the exit scan, freeze the exit time, and ask the fee calculator for the fee. */
export function createTicketClosing(dependencies: TicketClosingDependencies): TicketClosing {
  return createTicketClosingService(dependencies);
}

export type TicketCounts = Pick<TicketQuery, 'freeSpaces' | 'assistedTicketCount'>;

/** Tasks B10 and B11: free spaces and assisted tickets, both counted from the tickets themselves. */
export function createTicketCounts(dependencies: { readonly sites: Pick<TicketingSites, 'capacityOf'>; readonly store: TicketStore }): TicketCounts {
  return createTicketCountsService(dependencies);
}

/**
 * The identity area's logged plate lookup (task A4). The reader, the purpose and the site are written to the audit
 * trail by that area, which also decides who may see a plate; ticketing never holds one.
 */
export interface PlateLookup {
  readPlate(request: {
    readonly carRef: CarReference;
    readonly reader: PersonId;
    readonly purpose: 'receipt';
    readonly siteId: SiteId;
  }): Promise<Result<string, 'refused' | 'not resolvable'>>;
}

/**
 * Whose car it is. A driver may open a ticket only for a car registered to them (integrity, rank 1); the identity area
 * holds the cars, so the composition root fills this one question from Lino's PersonalData.
 */
export interface CarOwnership {
  carBelongsTo(carRef: CarReference, personId: PersonId): Promise<boolean>;
}

export interface TicketReadingDependencies {
  readonly store: TicketStore;
  readonly plates: PlateLookup;
  /** The hours on a receipt are the hours the fee was charged for, from the same calculator. */
  readonly fees: Pick<FeeCalculator, 'startedHours'>;
}

export type TicketReading = Pick<TicketQuery, 'ticketStatus' | 'ticketHistory' | 'receipt' | 'frequentSites' | 'closedTicketsBetween'>;

/** Tasks B12 and B13: a driver's tickets, one ticket's state, the receipt with the plate from the logged join, the driver's frequent sites and the closed tickets of a site. */
export function createTicketReading(dependencies: TicketReadingDependencies): TicketReading {
  return createTicketReadingService(dependencies);
}

export type TicketPaymentStatus = Pick<TicketDesk, 'changePaymentStatus'>;

/**
 * Task B9: the payment status of a closed ticket, changed only along the allowed paths. No request reaches this from
 * outside: the entry point registers no operation for it, and the caller (payments, or the approved waiver) is trusted
 * to be authorised, because the method is not told who is asking. The caller passes its own unit of work, so the
 * payment row, the ticket's status and the one audit entry commit together (P1, P18, P28 #29).
 */
export function createTicketPaymentStatus(dependencies: { readonly store: TicketStore }): TicketPaymentStatus {
  return createTicketPaymentStatusService(dependencies.store);
}

/** What `operations(dependencies)` needs: the fields of the composition root's `ModuleDependencies` this module reads (P4). */
export interface TicketingDependencies {
  readonly carOwnership: CarOwnership;
  readonly clock: Clock;
  readonly fees: FeeCalculator;
  readonly plates: PlateLookup;
  readonly prices: PriceList;
  readonly sites: TicketingSites;
  readonly tickets: TicketStore;
}

/** The requests this module answers; the composition root calls this once and registers the result (P4). */
export function operations(dependencies: TicketingDependencies): readonly Operation[] {
  const { sites, clock, prices, fees, plates, carOwnership, tickets: store } = dependencies;
  const opening = createTicketOpeningService({ sites, carOwnership, store, clock });
  const closing = createTicketClosingService({ sites, store, clock, prices, fees });
  const reading = createTicketReadingService({ store, plates, fees });
  const counts = createTicketCountsService({ sites, store });
  return [
    createOpenTicketOperation(opening),
    createCloseTicketOperation(closing, store, openSampleTicket({ clock, prices }, false)),
    ...createAssistedTicketOperations(opening, closing, openSampleTicket({ clock, prices }, true)),
    ...createReadOperations(reading, counts),
  ];
}
