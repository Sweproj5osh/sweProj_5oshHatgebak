/**
 * The Driver App's view of paying a closed ticket and reading its receipt. The app shows the server's answer; it
 * never decides whether a payment is valid, what the fee is, or whether a receipt is real (Rules A and I): the pay
 * request names the ticket and nothing else, the server knows the fee.
 *
 * The shapes are the owners': Amina's `PaymentRecord`, `AttemptState` and `PayRefusal` and her pay-in-app operation
 * (payments module on main: 201 with the payment, 202 with a pending attempt and the message "pay later or pay cash",
 * refusals with 402, 403 or 409), Karim's `Receipt` and the receipt read's refusal words (ticketing module on main).
 */
import type { PaymentId, SiteId, TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';

/** The state of one payment attempt (P18): pending until the provider's final answer, then paid or failed. */
export type AttemptState = 'pending' | 'paid' | 'failed';
export const ATTEMPT_STATES: readonly AttemptState[] = ['pending', 'paid', 'failed'];

export type PaymentMethod = 'app' | 'cash' | 'correction';
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['app', 'cash', 'correction'];

/** Amina's payment record. The amount is the server's figure, read back for the screen and never sent to it. */
export interface PaymentRecord {
  readonly paymentId: PaymentId;
  readonly ticketId: TicketId;
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly state: AttemptState;
  readonly reason?: string;
  readonly providerReference?: string;
}

/** The server's word for a pending attempt: the driver is never told the ticket is paid (section 9 of the rules). */
export const PAY_LATER_OR_PAY_CASH = 'pay later or pay cash';

/** What paying answers: the attempt, and the server's message when the attempt is still pending (202). */
export interface PayAnswer {
  readonly payment: PaymentRecord;
  readonly message?: string;
}

/** Karim's receipt: the plate comes from the logged join, so reading a receipt is itself logged (P9). */
export interface DriverReceipt {
  readonly ticketId: TicketId;
  readonly siteId: SiteId;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly hours: number;
  readonly fee: number;
  readonly plate: string;
}

/** Amina's PayRefusal words, Karim's receipt read words, and "not signed in" when the server refused the token. */
export type DriverPaymentRefusal =
  | 'declined'
  | 'ticket not closed'
  | 'nothing to pay'
  | 'not your ticket'
  | 'payment pending, try again shortly'
  | 'request id reused for another ticket or payer'
  | 'unknown ticket'
  | 'not signed in';

export const DRIVER_PAYMENT_REFUSALS: readonly DriverPaymentRefusal[] = [
  'declined',
  'ticket not closed',
  'nothing to pay',
  'not your ticket',
  'payment pending, try again shortly',
  'request id reused for another ticket or payer',
  'unknown ticket',
  'not signed in',
];

export function isDriverPaymentRefusal(candidate: unknown): candidate is DriverPaymentRefusal {
  return typeof candidate === 'string' && (DRIVER_PAYMENT_REFUSALS as readonly string[]).includes(candidate);
}

/** The server answered and said no. Nothing changed. */
export class DriverPaymentRefusedError extends Error {
  readonly refusal: DriverPaymentRefusal;

  constructor(refusal: DriverPaymentRefusal) {
    super(refusal);
    this.name = 'DriverPaymentRefusedError';
    this.refusal = refusal;
  }
}

export interface DriverPaymentApi {
  /** Pay the closed ticket in the app: the ticket id and the request id travel, the fee stays on the server (Rule I). */
  pay(ticketId: TicketId, requestId: RequestId): Promise<PayAnswer>;
  /** The receipt is a logged read: it carries the request id its one audit entry will name (P9). */
  receipt(ticketId: TicketId, requestId: RequestId): Promise<DriverReceipt>;
}
