/**
 * Payments — owner: Teammate C (Area 4). Must-stay-on set.
 * Payment records (app and cash), corrections as new rows, one charge per request id. Needs TicketDesk, AuditTrail
 * and the PaymentGateway port.
 */
import type { PaymentId, PersonId, SiteId, TicketId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { Result } from '../../shared/result';

export type ChargeOutcome = 'paid' | 'declined' | 'pending' | 'timed out';

export interface ChargeResult {
  readonly outcome: ChargeOutcome;
  readonly providerReference?: string;
}

/**
 * Port to the outside payment provider (ADR-11). The request id is the idempotency key (ADR-08).
 * `charge` answers within `timeoutMilliseconds` or returns "timed out" with no reference; it never throws for a slow
 * provider. `status` asks the provider about a charge it issued earlier, for settling pending payments (C5).
 */
export interface PaymentGateway {
  charge(amount: number, idempotencyKey: RequestId, timeoutMilliseconds: number): Promise<ChargeResult>;
  status(providerReference: string): Promise<ChargeOutcome>;
}

/** The fake provider for tests and the in-memory server (C1); the composition root builds it through this function. */
export { createFakePaymentGateway, type FakePaymentGateway } from './internal/adapters/fake-payment-gateway';

export interface PaymentRecord {
  readonly paymentId: PaymentId;
  readonly ticketId: TicketId;
  readonly amount: number;
  readonly method: 'app' | 'cash' | 'correction';
  readonly outcome: ChargeOutcome;
  readonly reason?: string;
}

export type PayRefusal = 'declined' | 'pay later or pay cash' | 'ticket not closed';

export interface PaymentLedger {
  payInApp(requestId: RequestId, ticketId: TicketId, payer: PersonId): Promise<Result<PaymentRecord, PayRefusal>>;
  tickCash(requestId: RequestId, ticketId: TicketId, attendantId: PersonId): Promise<Result<PaymentRecord, string>>;
  addCorrection(requestId: RequestId, paymentId: PaymentId, amount: number, reason: string): Promise<PaymentRecord>;
  settlePendingPayments(): Promise<number>;
  cashDueForShift(attendantId: PersonId, siteId: SiteId, shiftId: string): Promise<number>;
  paymentsForTicket(ticketId: TicketId): Promise<readonly PaymentRecord[]>;
}
