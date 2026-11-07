/**
 * In-memory stand-in for the payment data layer, for client tests that need no server (P14). It answers a repeated
 * request id with the same payment, as the pipeline does, and knows the fee itself: the client never sends one.
 */
import type { RequestId } from '../../shared/request-id';
import {
  DriverPaymentRefusedError,
  type DriverPaymentApi,
  type DriverReceipt,
  type PayAnswer,
  type PaymentRecord,
} from '../shared-client/payments/driver-payment-api';
import { ServerTransportError } from '../shared-client/server-call';

interface SavedTicket extends DriverReceipt {
  readonly paid: boolean;
}

export class InMemoryDriverPaymentApi implements DriverPaymentApi {
  private readonly tickets = new Map<string, SavedTicket>();
  private readonly answersByRequestId = new Map<RequestId, PayAnswer>();
  private transportDropsRemaining = 0;
  private paymentsMade = 0;

  constructor(initialTickets: readonly SavedTicket[] = []) {
    for (const ticket of initialTickets) {
      this.tickets.set(ticket.ticketId, ticket);
    }
  }

  /** Drop the next successful answer after the server has applied it. */
  dropNextAnswers(count: number): void {
    this.transportDropsRemaining = count;
  }

  async pay(ticketId: string, requestId: RequestId): Promise<PayAnswer> {
    const known = this.answersByRequestId.get(requestId);
    if (known !== undefined) {
      this.maybeDropAfterApply();
      return known;
    }

    const ticket = this.tickets.get(ticketId);
    if (ticket === undefined || ticket.closedAt.length === 0) {
      throw new DriverPaymentRefusedError('ticket not closed');
    }
    if (ticket.paid) {
      throw new DriverPaymentRefusedError('nothing to pay');
    }

    this.paymentsMade += 1;
    const payment: PaymentRecord = { paymentId: `payment-${this.paymentsMade}`, ticketId, amount: ticket.fee, method: 'app', state: 'paid' };
    const answer: PayAnswer = { payment };
    this.answersByRequestId.set(requestId, answer);
    this.tickets.set(ticketId, { ...ticket, paid: true });
    this.maybeDropAfterApply();
    return answer;
  }

  async receipt(ticketId: string): Promise<DriverReceipt> {
    const ticket = this.tickets.get(ticketId);
    if (ticket === undefined) {
      throw new DriverPaymentRefusedError('unknown ticket');
    }
    const { paid: _paid, ...receipt } = ticket;
    return receipt;
  }

  private maybeDropAfterApply(): void {
    if (this.transportDropsRemaining <= 0) {
      return;
    }
    this.transportDropsRemaining -= 1;
    throw new ServerTransportError();
  }
}
