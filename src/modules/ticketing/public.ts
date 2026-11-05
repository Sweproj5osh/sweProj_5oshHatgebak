/**
 * Ticketing — owner: Teammate B (Area 3). Must-stay-on set.
 * Open and close by scan, assisted tickets, one open ticket per car, no ticket when full, exit time frozen by the
 * server. Needs SiteRegistry, FeeCalculator, AuditTrail (Q12a: not Authorization or LicenceStatus).
 */
import type { PersonId, SiteId, TicketId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { Result } from '../../shared/result';

export type TicketState = 'open' | 'closed';
export type PaymentStatus = 'unpaid' | 'paid' | 'disputed' | 'waived';

export interface Ticket {
  readonly ticketId: TicketId;
  readonly siteId: SiteId;
  readonly driverRef: PersonId;
  readonly state: TicketState;
  readonly paymentStatus: PaymentStatus;
  readonly openedAt: string;
  readonly closedAt?: string;
  readonly fee?: number;
  readonly assisted: boolean;
}

export type OpenRefusal = 'site closed' | 'car already parked' | 'site full' | 'forged code' | 'wrong site';
export type CloseRefusal = 'no open ticket' | 'forged code' | 'wrong site';

export interface OpenTicketCommand {
  readonly requestId: RequestId;
  readonly driverRef: PersonId;
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
