import type { SiteId, TicketId } from '../../../shared/identifiers';
import type { Result } from '../../../shared/result';
import type { PaymentStatus, Ticket } from '../public';

export type StoreRefusal = 'car already parked' | 'site full';

export interface OpenRequest {
  /** Who sent it and with which request id; the same key always answers the same ticket. */
  readonly requestKey: string;
  readonly ticket: Ticket;
  readonly capacity: number;
}

/**
 * Where tickets live. Opening is one indivisible step: the repeat check, the one-ticket-per-car check, the space
 * check and the insert happen together, so no two openers can both see the last space (task B6, Rule E). The
 * PostgreSQL adapter does the same inside one transaction that locks the site.
 */
export interface TicketStore {
  findByRequestKey(requestKey: string): Promise<Ticket | undefined>;
  /** Returns the earlier ticket when the request key was already used, even if the car is parked by now. */
  openIfPossible(request: OpenRequest): Promise<Result<Ticket, StoreRefusal>>;
  /** Free spaces are capacity minus this count, computed from the tickets and never stored (task B11). */
  countOpen(siteId: SiteId): Promise<number>;
  findById(ticketId: TicketId): Promise<Ticket | undefined>;
  /**
   * Closes an open ticket with the frozen exit time and the fee, in one indivisible step. A request key already used
   * returns the ticket it closed; a ticket that is not open is refused.
   */
  closeIfOpen(request: CloseRequest): Promise<Result<Ticket, 'no open ticket'>>;
  /** Applies an already-approved payment status change in one indivisible step; a repeated request key answers the same ticket. */
  changePaymentStatus(request: PaymentStatusRequest): Promise<Result<Ticket, PaymentStatusRefusal>>;
}

export type PaymentStatusRefusal = 'unknown ticket' | 'ticket not closed' | 'status change not allowed';

export interface PaymentStatusRequest {
  readonly requestKey: string;
  readonly ticketId: TicketId;
  readonly to: PaymentStatus;
}

export interface CloseRequest {
  readonly requestKey: string;
  readonly ticketId: TicketId;
  readonly closedAt: string;
  readonly fee: number;
}
