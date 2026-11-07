/**
 * Ticketing — owner: Teammate B (Area 3). Must-stay-on set.
 * Open and close by scan, assisted tickets, one open ticket per car, no ticket when full, exit time frozen by the
 * server. Needs SiteRegistry, FeeCalculator, AuditTrail (Q12a: not Authorization or LicenceStatus).
 */
import type { Operation } from '../../entrypoint/operations/operation';
import type { FeeCalculator, PriceList } from '../committee-prices/public';
import type { Clock } from '../../shared/clock';
import type { PersonId, SiteId, TicketId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { Result } from '../../shared/result';
import { createCloseTicketOperation } from './internal/close-ticket-operation';
import { createOpenTicketOperation } from './internal/open-ticket-operation';
import type { TicketStore } from './internal/ticket-store';
import { createTicketClosingService } from './internal/ticket-closing';
import { createTicketPaymentStatusService } from './internal/ticket-payment-status';
import { createTicketOpeningService } from './internal/ticket-opening';

export { InMemoryTicketStore } from './internal/in-memory-ticket-store';
export type { TicketStore } from './internal/ticket-store';

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
  readonly assisted: boolean;
}

export type OpenRefusal = 'site closed' | 'car already parked' | 'site full' | 'forged code' | 'wrong site';
export type CloseRefusal = 'no open ticket' | 'forged code' | 'wrong site' | 'exit before entry' | 'no price known';

export interface OpenTicketCommand {
  readonly requestId: RequestId;
  readonly driverRef: PersonId;
  readonly carRef: CarReference;
  readonly siteId: SiteId;
  readonly entryCode: string;
}

export interface TicketDesk {
  openTicket(command: OpenTicketCommand): Promise<Result<Ticket, OpenRefusal>>;
  openAssistedTicket(command: OpenTicketCommand, attendantId: PersonId): Promise<Result<Ticket, OpenRefusal>>;
  closeTicket(requestId: RequestId, ticketId: TicketId, exitCode: string): Promise<Result<Ticket, CloseRefusal>>;
  changePaymentStatus(requestId: RequestId, ticketId: TicketId, to: PaymentStatus): Promise<Result<Ticket, string>>;
  closeStaleTickets(siteId: SiteId, maximumHours: number): Promise<readonly TicketId[]>;
}

export interface Receipt {
  readonly ticketId: TicketId;
  readonly siteId: SiteId;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly hours: number;
  readonly fee: number;
  readonly plate: string;
}

export interface TicketQuery {
  ticketStatus(ticketId: TicketId): Promise<Ticket>;
  ticketHistory(driverRef: PersonId): Promise<readonly Ticket[]>;
  freeSpaces(siteId: SiteId): Promise<number>;
  assistedTicketCount(siteId: SiteId, year: number, month: number): Promise<number>;
  receipt(ticketId: TicketId, reader: PersonId): Promise<Receipt>;
  frequentSites(driverRef: PersonId): Promise<readonly SiteId[]>;
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
  readonly store: TicketStore;
  readonly clock: Clock;
  /** Only tests replace this. */
  readonly newTicketId?: () => TicketId;
}

export type TicketOpening = Pick<TicketDesk, 'openTicket'>;

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

export type TicketClosing = Pick<TicketDesk, 'closeTicket'>;

/** Task B8: close a ticket by the exit scan, freeze the exit time, and ask the fee calculator for the fee. */
export function createTicketClosing(dependencies: TicketClosingDependencies): TicketClosing {
  return createTicketClosingService(dependencies);
}

export type TicketPaymentStatus = Pick<TicketDesk, 'changePaymentStatus'>;

/**
 * Task B9: the payment status of a closed ticket, changed only along the allowed paths. No request reaches this from
 * outside: the entry point registers no operation for it, and the caller (payments, or the approved waiver) is trusted
 * to be authorised, because the method is not told who is asking.
 */
export function createTicketPaymentStatus(dependencies: { readonly store: TicketStore }): TicketPaymentStatus {
  return createTicketPaymentStatusService(dependencies.store);
}

export interface TicketingOperationDependencies {
  readonly opening: TicketOpening;
  readonly closing: TicketClosing;
  readonly store: TicketStore;
}

/** The requests this module answers, for the composition root to register. */
export function createTicketingOperations(dependencies: TicketingOperationDependencies): readonly Operation[] {
  return [createOpenTicketOperation(dependencies.opening), createCloseTicketOperation(dependencies.closing, dependencies.store)];
}
