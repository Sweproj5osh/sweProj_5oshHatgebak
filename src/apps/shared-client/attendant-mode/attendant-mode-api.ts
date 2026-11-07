/**
 * The Staff App's view of attendant mode: clock in, list unpaid tickets, tick cash paid, and open an assisted ticket.
 * The app holds no business rules: it shows what the server says and keeps the request id for retrying the same
 * write after a lost answer. Who the attendant is comes from the token on every call, never from a body.
 */
import type { PersonId, SiteId, TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';

/** Lino's clock-in answer: the site the signed code named, now bound to the attendant's session. */
export interface AttendantClockInSuccess {
  readonly siteId: SiteId;
  readonly clockedIn: true;
}

export interface TicketSummary {
  readonly ticketId: TicketId;
  readonly driverId: PersonId;
  readonly siteId: SiteId;
  readonly plate: string;
  readonly paid: boolean;
  readonly assisted: boolean;
}

export interface AssistedTicketInput {
  readonly requestId: RequestId;
  readonly siteId: SiteId;
  readonly driverId: PersonId;
  readonly plate: string;
}

export interface AssistedTicketSuccess extends TicketSummary {
  readonly requestId: RequestId;
}

export interface MarkPaidSuccess {
  readonly requestId: RequestId;
  readonly ticketId: TicketId;
  readonly paid: boolean;
}

/** Lino's `ClockInRefusal` words, the words of the proposed calls, and "not signed in" when the token is refused. */
export type AttendantModeRefusal =
  | 'wrong site'
  | 'forged code'
  | 'not assigned'
  | 'licence not live'
  | 'not clocked in'
  | 'ticket not found'
  | 'not signed in';

export const ATTENDANT_MODE_REFUSALS: readonly AttendantModeRefusal[] = [
  'wrong site',
  'forged code',
  'not assigned',
  'licence not live',
  'not clocked in',
  'ticket not found',
  'not signed in',
];

export function isAttendantModeRefusal(candidate: unknown): candidate is AttendantModeRefusal {
  return typeof candidate === 'string' && (ATTENDANT_MODE_REFUSALS as readonly string[]).includes(candidate);
}

/** The server answered and said no. Nothing changed. */
export class AttendantModeRefusedError extends Error {
  readonly refusal: AttendantModeRefusal;

  constructor(refusal: AttendantModeRefusal) {
    super(refusal);
    this.name = 'AttendantModeRefusedError';
    this.refusal = refusal;
  }
}

export interface AttendantModeApi {
  /** The scanned site code is all that travels; the server reads the attendant from the token and the site from the code. */
  clockIn(siteCode: string, requestId: RequestId): Promise<AttendantClockInSuccess>;
  listOpenTickets(siteId: SiteId): Promise<readonly TicketSummary[]>;
  listCarsWaitingForCash(siteId: SiteId): Promise<readonly string[]>;
  openAssistedTicket(input: AssistedTicketInput): Promise<AssistedTicketSuccess>;
  markTicketPaid(ticketId: TicketId, requestId: RequestId): Promise<MarkPaidSuccess>;
}
