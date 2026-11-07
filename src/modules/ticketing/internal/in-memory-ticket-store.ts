import { SerialQueue } from '../../../shared/serial-queue';
import type { PersonId, SiteId, TicketId } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import type { Ticket } from '../public';
import { ALLOWED_PAYMENT_CHANGES } from './ticket-payment-status';
import type { CloseRequest, OpenRequest, PaymentStatusRefusal, PaymentStatusRequest, StoreRefusal, TicketStore } from './ticket-store';

export class InMemoryTicketStore implements TicketStore {
  private readonly queue = new SerialQueue();
  private tickets: readonly Ticket[] = [];
  private readonly byRequestKey = new Map<string, TicketId>();

  async findByRequestKey(requestKey: string): Promise<Ticket | undefined> {
    const ticketId = this.byRequestKey.get(requestKey);
    return ticketId === undefined ? undefined : this.tickets.find((ticket) => ticket.ticketId === ticketId);
  }

  openIfPossible(request: OpenRequest): Promise<Result<Ticket, StoreRefusal>> {
    return this.queue.run(async () => {
      const earlier = await this.findByRequestKey(request.requestKey);
      if (earlier !== undefined) {
        return succeed(earlier);
      }
      if (this.tickets.some((ticket) => ticket.state === 'open' && ticket.carRef === request.ticket.carRef)) {
        return fail('car already parked');
      }
      if (this.openCount(request.ticket.siteId) >= request.capacity) {
        return fail('site full');
      }
      this.tickets = [...this.tickets, request.ticket];
      this.byRequestKey.set(request.requestKey, request.ticket.ticketId);
      return succeed(request.ticket);
    });
  }

  async countOpen(siteId: SiteId): Promise<number> {
    return this.openCount(siteId);
  }

  async countAssisted(siteId: SiteId, year: number, month: number): Promise<number> {
    return this.tickets.filter((ticket) => {
      const openedAt = new Date(ticket.openedAt);
      return ticket.assisted && ticket.siteId === siteId && openedAt.getUTCFullYear() === year && openedAt.getUTCMonth() + 1 === month;
    }).length;
  }

  async listByDriver(driverRef: PersonId): Promise<readonly Ticket[]> {
    return this.tickets
      .map((ticket, index) => ({ ticket, index }))
      .filter(({ ticket }) => ticket.driverRef === driverRef)
      .sort((a, b) => b.ticket.openedAt.localeCompare(a.ticket.openedAt) || b.index - a.index)
      .map(({ ticket }) => ticket);
  }

  async findById(ticketId: TicketId): Promise<Ticket | undefined> {
    return this.tickets.find((ticket) => ticket.ticketId === ticketId);
  }

  closeIfOpen(request: CloseRequest): Promise<Result<Ticket, 'no open ticket'>> {
    return this.queue.run(async () => {
      const earlier = await this.findByRequestKey(request.requestKey);
      if (earlier !== undefined) {
        return succeed(earlier);
      }
      const current = this.tickets.find((ticket) => ticket.ticketId === request.ticketId);
      if (current === undefined || current.state !== 'open') {
        return fail('no open ticket');
      }
      const closed: Ticket = { ...current, state: 'closed', closedAt: request.closedAt, fee: request.fee };
      this.tickets = this.tickets.map((ticket) => (ticket.ticketId === request.ticketId ? closed : ticket));
      this.byRequestKey.set(request.requestKey, request.ticketId);
      return succeed(closed);
    });
  }

  changePaymentStatus(request: PaymentStatusRequest): Promise<Result<Ticket, PaymentStatusRefusal>> {
    return this.queue.run(async () => {
      const earlier = await this.findByRequestKey(request.requestKey);
      if (earlier !== undefined) {
        return succeed(earlier);
      }
      const current = this.tickets.find((ticket) => ticket.ticketId === request.ticketId);
      if (current === undefined) {
        return fail('unknown ticket');
      }
      if (current.state !== 'closed') {
        return fail('ticket not closed');
      }
      const allowed = ALLOWED_PAYMENT_CHANGES[current.paymentStatus] ?? [];
      if (!allowed.includes(request.to)) {
        return fail('status change not allowed');
      }
      const changed: Ticket = { ...current, paymentStatus: request.to };
      this.tickets = this.tickets.map((ticket) => (ticket.ticketId === request.ticketId ? changed : ticket));
      this.byRequestKey.set(request.requestKey, request.ticketId);
      return succeed(changed);
    });
  }

  private openCount(siteId: SiteId): number {
    return this.tickets.filter((ticket) => ticket.state === 'open' && ticket.siteId === siteId).length;
  }
}
