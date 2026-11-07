import { randomUUID } from 'node:crypto';
import type { TicketDesk, TicketQuery } from '../../ticketing/public';
import type { Clock } from '../../../shared/clock';
import type { EventPublisher } from '../../../shared/events/event';
import type { PaymentId, PersonId, SiteId, TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';
import { fail, succeed, type Result } from '../../../shared/result';
import type { PaymentGateway, PaymentLedger, PaymentRecord, PayRefusal } from '../public';
import type { InFlightAttempts } from './in-flight-attempts';
import type { PaymentStore, StoredPayment } from './ports';
import { askProvider, type ProviderAnswer } from './provider-answer';

/** The provider gets this long to answer before the attempt stays pending and the driver is told to pay later (P18, C4). */
export const PROVIDER_TIMEOUT_MILLISECONDS = 8_000;

/** Published after a payment lands, for Notifications, the dashboard and the money check (ADR-07). */
export const TICKET_PAID_TOPIC = 'TicketPaid';

/** What the driver reads when the attempt is pending: the provider has not given its final answer (section 9 of the rules). */
export const PAY_LATER_OR_PAY_CASH = 'pay later or pay cash';

export interface TicketPaidPayload {
  readonly ticketId: TicketId;
  readonly paymentId: PaymentId;
  readonly amount: number;
  readonly providerReference?: string;
}

export interface PaymentLedgerDependencies {
  readonly gateway: PaymentGateway;
  readonly ticketDesk: Pick<TicketDesk, 'changePaymentStatus'>;
  readonly ticketQuery: Pick<TicketQuery, 'ticketStatus'>;
  readonly clock: Clock;
  /** Shared by every ledger of the module: the per-ticket lock outlives one unit of work. */
  readonly inFlight: InFlightAttempts;
}

/**
 * The payments ledger for one unit of work (task C2). Paying in the app: ask Ticketing for the ticket, record a
 * pending attempt, charge the provider with the request id as the idempotency key, record the answer on the attempt,
 * mark the ticket paid and publish "ticket paid". The row, the ticket status, the audit entry and the event commit
 * together (Rule E).
 *
 * One attempt per ticket (P18): an attempt stays `pending` until the provider's final answer, and a ticket with a
 * pending attempt refuses a second charge, whether that attempt is committed (the row) or still in flight in another
 * unit of work (the per-ticket claim in `InFlightAttempts`). The 8-second timer is the ledger's, so every adapter is
 * timed the same way; the attempt row is written before the provider is asked, so a late answer finds its row at
 * reconciliation.
 *
 * One charge per request id (task C3) holds at two levels: the entry point answers a repeat from its stored
 * response without calling the ledger, and the ledger itself answers from the row the id already created, so even
 * a caller that bypasses the entry point cannot charge the provider twice for one id.
 */
export class PaymentLedgerService implements PaymentLedger {
  constructor(
    private readonly dependencies: PaymentLedgerDependencies,
    private readonly store: PaymentStore,
    private readonly events: EventPublisher,
  ) {}

  async payInApp(requestId: RequestId, ticketId: TicketId, payer: PersonId): Promise<Result<PaymentRecord, PayRefusal>> {
    const alreadyRecorded = await this.store.byRequestId(requestId);
    if (alreadyRecorded !== undefined) {
      return succeed(toRecord(alreadyRecorded));
    }
    const refusal = await this.whyTicketCannotBeCharged(ticketId, payer);
    if (refusal !== undefined) {
      return fail(refusal);
    }
    if (!this.dependencies.inFlight.claim(ticketId, requestId)) {
      return fail('payment pending, try again shortly');
    }
    const fee = (await this.dependencies.ticketQuery.ticketStatus(ticketId)).fee;
    if (fee === undefined) {
      throw new Error(`Ticket ${ticketId} is closed but carries no fee`);
    }
    const attempt = await this.recordPendingAttempt(requestId, ticketId, payer, fee);
    const answer = await askProvider(() => this.dependencies.gateway.charge(fee, requestId), PROVIDER_TIMEOUT_MILLISECONDS);
    return this.recordAnswer(attempt, answer);
  }

  async tickCash(_requestId: RequestId, _ticketId: TicketId, _attendantId: PersonId): Promise<Result<PaymentRecord, string>> {
    throw new Error('Cash ticks are built in task C6');
  }

  async addCorrection(_requestId: RequestId, _paymentId: PaymentId, _amount: number, _reason: string): Promise<PaymentRecord> {
    throw new Error('Corrections are built in task C7');
  }

  async settlePendingPayments(): Promise<number> {
    throw new Error('Settling pending payments is built in task C5');
  }

  async cashDueForShift(_attendantId: PersonId, _siteId: SiteId, _shiftId: string): Promise<number> {
    throw new Error('Cash due per shift is built in task C8');
  }

  async paymentsForTicket(ticketId: TicketId): Promise<readonly PaymentRecord[]> {
    return (await this.store.forTicket(ticketId)).map(toRecord);
  }

  /** The ticket's own state first, then the attempts already recorded against it (P18). */
  private async whyTicketCannotBeCharged(ticketId: TicketId, payer: PersonId): Promise<PayRefusal | undefined> {
    const ticket = await this.dependencies.ticketQuery.ticketStatus(ticketId);
    if (ticket.driverRef !== payer) {
      return 'not your ticket';
    }
    if (ticket.state !== 'closed' || ticket.fee === undefined) {
      return 'ticket not closed';
    }
    if (ticket.paymentStatus !== 'unpaid') {
      return 'nothing to pay';
    }
    const attempts = await this.store.forTicket(ticketId);
    if (attempts.some((attempt) => attempt.state === 'pending')) {
      this.dependencies.inFlight.release(ticketId);
      return 'payment pending, try again shortly';
    }
    if (attempts.some((attempt) => attempt.state === 'paid')) {
      this.dependencies.inFlight.release(ticketId);
      return 'nothing to pay';
    }
    return undefined;
  }

  /** Written before the provider is asked, so the row exists whatever the provider does with the next eight seconds. */
  private async recordPendingAttempt(requestId: RequestId, ticketId: TicketId, payer: PersonId, fee: number): Promise<StoredPayment> {
    const attempt: StoredPayment = {
      paymentId: `payment-${randomUUID()}`,
      ticketId,
      amount: fee,
      method: 'app',
      state: 'pending',
      requestId,
      payerId: payer,
      recordedAt: this.dependencies.clock.now().toISOString(),
    };
    await this.store.add(attempt);
    return attempt;
  }

  private async recordAnswer(attempt: StoredPayment, answer: ProviderAnswer): Promise<Result<PaymentRecord, PayRefusal>> {
    switch (answer.kind) {
      case 'declined':
        this.dependencies.inFlight.release(attempt.ticketId);
        return fail('declined');
      case 'paid':
        return succeed(toRecord(await this.recordPaid(attempt, answer.providerReference)));
      case 'pending':
        return succeed(toRecord(await this.replaceAttempt({ ...attempt, providerReference: answer.providerReference })));
      case 'no answer':
        return succeed(toRecord(attempt));
    }
  }

  private async recordPaid(attempt: StoredPayment, providerReference: string): Promise<StoredPayment> {
    const paid = await this.replaceAttempt({ ...attempt, state: 'paid', providerReference, settledAt: this.dependencies.clock.now().toISOString() });
    await this.markTicketPaid(paid.requestId, paid.ticketId);
    const payload: TicketPaidPayload = { ticketId: paid.ticketId, paymentId: paid.paymentId, amount: paid.amount, providerReference };
    this.events.publish({ topic: TICKET_PAID_TOPIC, payload });
    return paid;
  }

  private async replaceAttempt(attempt: StoredPayment): Promise<StoredPayment> {
    await this.store.replace(attempt);
    return attempt;
  }

  /**
   * The provider has taken the money, so a ticket that cannot be marked paid is an error, not a refusal: the whole
   * write rolls back, and the driver's retry with the same request id reaches the provider's stored answer, never
   * a second charge (ADR-08).
   */
  private async markTicketPaid(requestId: RequestId, ticketId: TicketId): Promise<void> {
    // TODO(P1): pass the unit of work first once Karim's changePaymentStatus(unitOfWork, requestId, ticketId, to) lands.
    const marked = await this.dependencies.ticketDesk.changePaymentStatus(requestId, ticketId, 'paid');
    if (!marked.ok) {
      throw new Error(`Ticket ${ticketId} was charged but could not be marked paid: ${marked.error}`);
    }
  }
}

/** The public record: the stored row without the module's own bookkeeping columns. */
export function toRecord(payment: StoredPayment): PaymentRecord {
  const { requestId: _requestId, payerId: _payerId, recordedAt: _recordedAt, settledAt: _settledAt, ...record } = payment;
  return record;
}
