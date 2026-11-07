/**
 * Payments — owner: Teammate C (Area 4). Must-stay-on set.
 * Payment records (app and cash), corrections as new rows, one charge per request id. Needs TicketDesk, AuditTrail
 * and the PaymentGateway port.
 */
import type { Operation } from '../../shared/operation-contract';
import type { Clock } from '../../shared/clock';
import type { EventPublisher } from '../../shared/events/event';
import type { PaymentId, PersonId, SiteId, TicketId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { Result } from '../../shared/result';
import type { Transaction } from '../../shared/unit-of-work';
import type { TicketDesk, TicketQuery } from '../ticketing/public';
import { payInAppOperation } from './internal/operations/pay-in-app';
import { PaymentLedgerService } from './internal/payment-ledger';
import { TableAccessPaymentStore } from './internal/adapters/table-access-payment-store';
import { InFlightAttempts } from './internal/in-flight-attempts';

/** The provider's answer to a charge. Anything else an adapter lets through is an adapter error (Rule B). */
export type ChargeOutcome = 'paid' | 'declined' | 'pending';

export interface ChargeResult {
  readonly outcome: ChargeOutcome;
  readonly providerReference?: string;
}

/**
 * Port to the outside payment provider (ADR-11). The request id is the idempotency key (ADR-08): the same key asked
 * twice gives the provider's first answer. The adapter does not time itself; the ledger gives up after its own
 * 8-second timer (P18), so a slow provider simply answers late. `status` asks the provider about a charge it issued
 * earlier, for settling pending payments (C5).
 */
export interface PaymentGateway {
  charge(amount: number, idempotencyKey: RequestId): Promise<ChargeResult>;
  status(providerReference: string): Promise<ChargeOutcome>;
}

/**
 * The state of one payment attempt (P18): `pending` until the provider's final answer, then `paid` or `failed`. It is
 * a state of the attempt, never of the ticket, whose payment status stays within unpaid/paid/disputed/waived.
 */
export type AttemptState = 'pending' | 'paid' | 'failed';

/** The fake provider for tests and the in-memory server (C1); the composition root builds it through this function. */
export { createFakePaymentGateway, type FakePaymentGateway } from './internal/adapters/fake-payment-gateway';

export interface PaymentRecord {
  readonly paymentId: PaymentId;
  readonly ticketId: TicketId;
  readonly amount: number;
  readonly method: 'app' | 'cash' | 'correction';
  readonly state: AttemptState;
  readonly reason?: string;
  /** The provider's reference for an app payment; absent for cash and corrections. */
  readonly providerReference?: string;
}

/**
 * Why a pay in the app was refused. "declined" and "ticket not closed" come from the task sheet; "nothing to pay" (the
 * ticket is already paid or waived) and "not your ticket" keep one ticket from being charged twice or by a stranger;
 * "payment pending, try again shortly" is P18: a ticket with a pending attempt takes no second charge; "request id
 * reused for another ticket or payer" is P19: the module's own repeat guard beside the pipeline's. A timed-out or
 * pending provider answer is not a refusal: the attempt is recorded as pending and the driver reads "pay later or pay
 * cash" (section 9 of the rules).
 */
export type PayRefusal =
  | 'declined'
  | 'ticket not closed'
  | 'nothing to pay'
  | 'not your ticket'
  | 'payment pending, try again shortly'
  | 'request id reused for another ticket or payer';

export interface PaymentLedger {
  payInApp(requestId: RequestId, ticketId: TicketId, payer: PersonId): Promise<Result<PaymentRecord, PayRefusal>>;
  tickCash(requestId: RequestId, ticketId: TicketId, attendantId: PersonId): Promise<Result<PaymentRecord, string>>;
  addCorrection(requestId: RequestId, paymentId: PaymentId, amount: number, reason: string): Promise<PaymentRecord>;
  settlePendingPayments(): Promise<number>;
  cashDueForShift(attendantId: PersonId, siteId: SiteId, shiftId: string): Promise<number>;
  paymentsForTicket(ticketId: TicketId): Promise<readonly PaymentRecord[]>;
}

/** What this module needs from Ticketing: the ticket's state and the one status change payments may make. */
export interface PaymentsDependencies {
  readonly gateway: PaymentGateway;
  readonly ticketDesk: Pick<TicketDesk, 'changePaymentStatus'>;
  readonly ticketQuery: Pick<TicketQuery, 'ticketStatus'>;
  readonly clock: Clock;
}

export interface Payments {
  /** The ledger joined to one write's unit of work, so its rows and events commit with the audit entry (Rule E, ADR-13). */
  ledgerBoundTo(transaction: Transaction, events: EventPublisher): PaymentLedger;
  /** The operations this module registers with the entry point. */
  readonly operations: readonly Operation[];
}

/** The composition root builds this module through this one function; nothing else constructs its internals. */
export function createPayments(dependencies: PaymentsDependencies): Payments {
  const inFlight = new InFlightAttempts();
  const ledgerBoundTo: Payments['ledgerBoundTo'] = (transaction, events) =>
    new PaymentLedgerService({ ...dependencies, inFlight }, new TableAccessPaymentStore(transaction), events, transaction);
  return { ledgerBoundTo, operations: [payInAppOperation({ ledgerBoundTo })] };
}

/**
 * The operations this module registers with the entry point; the composition root calls this once (P4). It needs the
 * payment gateway, Ticketing's desk and query and the clock from `ModuleDependencies`.
 */
export function operations(dependencies: PaymentsDependencies): readonly Operation[] {
  return createPayments(dependencies).operations;
}

export { PAYMENTS_TABLE } from './internal/adapters/table-access-payment-store';
export { PAY_LATER_OR_PAY_CASH, PROVIDER_TIMEOUT_MILLISECONDS, TICKET_PAID_TOPIC, type TicketPaidPayload } from './internal/payment-ledger';
