/**
 * The Driver App's view of ticket open and close by scan. The real adapter calls the main system's HTTP entry point
 * (`http-ticket-scan-api.ts`); tests that need no server use the in-memory stand-in in `src/apps/test-support`.
 * The app holds no ticket rules: it only sends what the driver scanned and shows what the server returned.
 *
 * The shapes are Karim's (ticketing public interface): opening takes the site, the car reference the driver chose
 * from their cars and the entry code; closing takes the ticket and the exit code; both answer his `Ticket`, whose
 * state is open or closed and whose times and fee are the server's. Who the driver is comes from the token.
 */
import type { PersonId, SiteId, TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';

export interface OpenTicketScanInput {
  readonly requestId: RequestId;
  readonly siteId: SiteId;
  readonly carRef: string;
  readonly entryCode: string;
}

export interface CloseTicketScanInput {
  readonly requestId: RequestId;
  readonly ticketId: TicketId;
  readonly exitCode: string;
}

export type TicketState = 'open' | 'closed';
export const TICKET_STATES: readonly TicketState[] = ['open', 'closed'];

export type PaymentStatus = 'unpaid' | 'paid' | 'disputed' | 'waived';
export const PAYMENT_STATUSES: readonly PaymentStatus[] = ['unpaid', 'paid', 'disputed', 'waived'];

/** Karim's `Ticket` as the server answers it; every time and the fee are the server's (Rule I). */
export interface ScannedTicket {
  readonly ticketId: TicketId;
  readonly siteId: SiteId;
  readonly driverRef: PersonId;
  readonly carRef: string;
  readonly state: TicketState;
  readonly paymentStatus: PaymentStatus;
  readonly openedAt: string;
  readonly closedAt?: string;
  readonly fee?: number;
  readonly assisted: boolean;
}

/** Karim's `OpenRefusal` and `CloseRefusal`, his "not your ticket", and "not signed in" when the token is refused. */
export type TicketScanRefusal =
  | 'site closed'
  | 'car already parked'
  | 'site full'
  | 'forged code'
  | 'wrong site'
  | 'attendant not assigned to this site'
  | 'no open ticket'
  | 'exit before entry'
  | 'no price known'
  | 'not an assisted ticket'
  | 'car does not match'
  | 'not your ticket'
  | 'not signed in';

export const TICKET_SCAN_REFUSALS: readonly TicketScanRefusal[] = [
  'site closed',
  'car already parked',
  'site full',
  'forged code',
  'wrong site',
  'attendant not assigned to this site',
  'no open ticket',
  'exit before entry',
  'no price known',
  'not an assisted ticket',
  'car does not match',
  'not your ticket',
  'not signed in',
];

export function isTicketScanRefusal(candidate: unknown): candidate is TicketScanRefusal {
  return typeof candidate === 'string' && (TICKET_SCAN_REFUSALS as readonly string[]).includes(candidate);
}

/** The server answered and said no. Nothing was changed. */
export class TicketScanRefusedError extends Error {
  readonly refusal: TicketScanRefusal;

  constructor(refusal: TicketScanRefusal) {
    super(refusal);
    this.name = 'TicketScanRefusedError';
    this.refusal = refusal;
  }
}

export interface TicketScanApi {
  openTicket(input: OpenTicketScanInput): Promise<ScannedTicket>;
  closeTicket(input: CloseTicketScanInput): Promise<ScannedTicket>;
}
