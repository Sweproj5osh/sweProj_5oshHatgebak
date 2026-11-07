import type { PersonId, SiteId, TicketId } from '../../../shared/identifiers';
import type { Result } from '../../../shared/result';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { PaymentStatus, Ticket } from '../public';

export type StoreRefusal = 'car already parked' | 'site full';

export interface OpenRequest {
  /** Who sent it and with which request id; the same key always answers the same ticket. */
  readonly requestKey: string;
  readonly ticket: Ticket;
  readonly capacity: number;
}

/**
 * Where tickets live. Every method works on the tables it is handed (ADR-13, P1): a write handler passes its unit of
 * work, so the ticket, the audit entry and the events commit or roll back together; a read passes the committed tables
 * or, for a logged read, its unit of work.
 *
 * The contract of `openIfPossible`: deciding capacity and inserting the ticket is one indivisible step. The repeat check,
 * the one-ticket-per-car check, the space check and the insert happen together against the same view of the tables, so
 * no two openers can both see the last space (task B6, Rule E, fitness function F3). The table-backed store serialises
 * that step per process; the PostgreSQL adapter must do it inside the caller's transaction under a lock on the site
 * (`SELECT … FOR UPDATE` on the site row or `pg_advisory_xact_lock(<site>)`), because two transactions do not see each
 * other's uncommitted tickets and nothing else serialises them across server copies (ADR-13, consequences).
 */
export interface TicketStore {
  findByRequestKey(tables: TableAccess, requestKey: string): Promise<Ticket | undefined>;
  /** Returns the earlier ticket when the request key was already used, even if the car is parked by now. */
  openIfPossible(tables: TableAccess, request: OpenRequest): Promise<Result<Ticket, StoreRefusal>>;
  /** Free spaces are capacity minus this count, computed from the tickets and never stored (task B11). */
  countOpen(tables: TableAccess, siteId: SiteId): Promise<number>;
  /** Assisted tickets opened at a site in a Cairo calendar month (Africa/Cairo, task B10), open or closed. */
  countAssisted(tables: TableAccess, siteId: SiteId, year: number, month: number): Promise<number>;
  findById(tables: TableAccess, ticketId: TicketId): Promise<Ticket | undefined>;
  /** A driver's tickets, newest first. */
  listByDriver(tables: TableAccess, driverRef: PersonId): Promise<readonly Ticket[]>;
  /**
   * Closes an open ticket with the frozen exit time and the fee, in one indivisible step. A request key already used
   * returns the ticket it closed; a ticket that is not open is refused.
   */
  closeIfOpen(tables: TableAccess, request: CloseRequest): Promise<Result<Ticket, 'no open ticket'>>;
  /** Applies an already-approved payment status change in one indivisible step; a repeated request key answers the same ticket. */
  changePaymentStatus(tables: TableAccess, request: PaymentStatusRequest): Promise<Result<Ticket, PaymentStatusRefusal>>;
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
