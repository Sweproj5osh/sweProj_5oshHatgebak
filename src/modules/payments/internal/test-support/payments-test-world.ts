import { FixedClock } from '../../../../shared/clock';
import type { PersonId, TicketId } from '../../../../shared/identifiers';
import type { RequestId } from '../../../../shared/request-id';
import { fail, succeed, type Result } from '../../../../shared/result';
import type { TableAccess, Transaction } from '../../../../shared/unit-of-work';
import type { CarReference, PaymentStatus, Ticket, TicketDesk, TicketQuery } from '../../../ticketing/public';
import { createFakePaymentGateway, createPayments, type FakePaymentGateway, type PaymentGateway, type Payments } from '../../public';

/**
 * The one set-up every payments test builds on: a fixed clock, a stand-in for Ticketing, the fake provider and the
 * module composed over them. Test files add only what the entry point needs (the composed application) on top. This
 * file is imported by tests alone; it holds no business rule, only the stand-in's bookkeeping.
 */
export const PAY_PATH = '/payments/app';
export const DRIVER: PersonId = 'driver-1';
export const CAR: CarReference = 'car-1';
export const TEST_START = new Date('2026-11-06T10:05:00Z');

/** A stand-in for Teammate B's Ticketing, holding tickets in a map; only the two calls payments makes exist. */
export class FakeTickets implements Pick<TicketDesk, 'changePaymentStatus'>, Pick<TicketQuery, 'ticketStatus'> {
  private readonly tickets = new Map<TicketId, Ticket>();

  seed(ticket: Ticket): void {
    this.tickets.set(ticket.ticketId, ticket);
  }

  ticketStatus(_tables: TableAccess, ticketId: TicketId): Promise<Ticket> {
    return this.statusOf(ticketId);
  }

  /** What the stand-in holds for a ticket, for a test's own assertions. */
  async statusOf(ticketId: TicketId): Promise<Ticket> {
    const ticket = this.tickets.get(ticketId);
    if (ticket === undefined) {
      throw new Error(`No ticket ${ticketId}`);
    }
    return ticket;
  }

  async changePaymentStatus(_unitOfWork: Transaction, _requestId: RequestId, ticketId: TicketId, to: PaymentStatus): Promise<Result<Ticket, string>> {
    const ticket = this.tickets.get(ticketId);
    if (ticket === undefined) {
      return fail('no such ticket');
    }
    const changed = { ...ticket, paymentStatus: to };
    this.tickets.set(ticketId, changed);
    return succeed(changed);
  }
}

/** A closed, unpaid ticket of the test driver with the given fee; the fee's last digit scripts the fake provider. */
export function closedTicket(ticketId: TicketId, fee: number, overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticketId,
    siteId: 'site-1',
    driverRef: DRIVER,
    carRef: CAR,
    state: 'closed',
    paymentStatus: 'unpaid',
    openedAt: '2026-11-06T08:00:00.000Z',
    closedAt: '2026-11-06T10:00:00.000Z',
    fee,
    assisted: false,
    ...overrides,
  };
}

export function openTicket(ticketId: TicketId): Ticket {
  return {
    ticketId,
    siteId: 'site-1',
    driverRef: DRIVER,
    carRef: CAR,
    state: 'open',
    paymentStatus: 'unpaid',
    openedAt: '2026-11-06T08:00:00.000Z',
    assisted: false,
  };
}

export interface PaymentsTestWorld {
  readonly clock: FixedClock;
  readonly tickets: FakeTickets;
  /** The fake provider; when a test hands in its own gateway, the fake stays here unused. */
  readonly gateway: FakePaymentGateway;
  readonly payments: Payments;
}

export function buildPaymentsWorld(overrides: { readonly gateway?: PaymentGateway } = {}): PaymentsTestWorld {
  const clock = new FixedClock(TEST_START);
  const tickets = new FakeTickets();
  const gateway = createFakePaymentGateway();
  const payments = createPayments({ gateway: overrides.gateway ?? gateway, ticketDesk: tickets, ticketQuery: tickets, clock });
  return { clock, tickets, gateway, payments };
}
