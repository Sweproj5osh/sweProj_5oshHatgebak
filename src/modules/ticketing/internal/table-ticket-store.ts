import type { PersonId, SiteId, TicketId } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import { SerialQueue } from '../../../shared/serial-queue';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { Ticket } from '../public';
import { ALLOWED_PAYMENT_CHANGES } from './ticket-payment-status';
import type { CloseRequest, OpenRequest, PaymentStatusRefusal, PaymentStatusRequest, StoreRefusal, TicketStore } from './ticket-store';

/** The module's two tables: the tickets by id, and the request keys already answered, each naming its ticket. */
export const TICKETS_TABLE = 'ticketing_tickets';
export const TICKET_REQUEST_KEYS_TABLE = 'ticketing_request_keys';

interface RequestKeyRow {
  readonly ticketId: TicketId;
}

/**
 * The ticket store over the shared tables (ADR-13): it holds nothing itself, so whatever unit of work a caller passes
 * decides what is seen and what commits. The three indivisible steps (open, close, change payment status) run one at a
 * time per process; across transactions and server copies the PostgreSQL adapter's site lock is the guard (see the
 * contract on `TicketStore`).
 */
export class TableTicketStore implements TicketStore {
  private readonly oneStepAtATime = new SerialQueue();

  async findByRequestKey(tables: TableAccess, requestKey: string): Promise<Ticket | undefined> {
    const answered = await tables.read<RequestKeyRow>(TICKET_REQUEST_KEYS_TABLE, requestKey);
    return answered === undefined ? undefined : this.findById(tables, answered.ticketId);
  }

  openIfPossible(tables: TableAccess, request: OpenRequest): Promise<Result<Ticket, StoreRefusal>> {
    return this.oneStepAtATime.run(async () => {
      const earlier = await this.findByRequestKey(tables, request.requestKey);
      if (earlier !== undefined) {
        return succeed(earlier);
      }
      const tickets = await tables.list<Ticket>(TICKETS_TABLE);
      if (tickets.some((ticket) => ticket.state === 'open' && ticket.carRef === request.ticket.carRef)) {
        return fail('car already parked');
      }
      if (openTicketsAt(tickets, request.ticket.siteId) >= request.capacity) {
        return fail('site full');
      }
      await tables.insert(TICKETS_TABLE, request.ticket.ticketId, request.ticket);
      await rememberAnswer(tables, request.requestKey, request.ticket.ticketId);
      return succeed(request.ticket);
    });
  }

  async countOpen(tables: TableAccess, siteId: SiteId): Promise<number> {
    return openTicketsAt(await tables.list<Ticket>(TICKETS_TABLE), siteId);
  }

  async countAssisted(tables: TableAccess, siteId: SiteId, year: number, month: number): Promise<number> {
    const tickets = await tables.list<Ticket>(TICKETS_TABLE);
    return tickets.filter((ticket) => {
      const openedAt = new Date(ticket.openedAt);
      return ticket.assisted && ticket.siteId === siteId && openedAt.getUTCFullYear() === year && openedAt.getUTCMonth() + 1 === month;
    }).length;
  }

  async listByDriver(tables: TableAccess, driverRef: PersonId): Promise<readonly Ticket[]> {
    const tickets = await tables.list<Ticket>(TICKETS_TABLE);
    return tickets
      .map((ticket, index) => ({ ticket, index }))
      .filter(({ ticket }) => ticket.driverRef === driverRef)
      .sort((a, b) => b.ticket.openedAt.localeCompare(a.ticket.openedAt) || b.index - a.index)
      .map(({ ticket }) => ticket);
  }

  findById(tables: TableAccess, ticketId: TicketId): Promise<Ticket | undefined> {
    return tables.read<Ticket>(TICKETS_TABLE, ticketId);
  }

  closeIfOpen(tables: TableAccess, request: CloseRequest): Promise<Result<Ticket, 'no open ticket'>> {
    return this.oneStepAtATime.run(async () => {
      const earlier = await this.findByRequestKey(tables, request.requestKey);
      if (earlier !== undefined) {
        return succeed(earlier);
      }
      const current = await this.findById(tables, request.ticketId);
      if (current === undefined || current.state !== 'open') {
        return fail('no open ticket');
      }
      const closed: Ticket = { ...current, state: 'closed', closedAt: request.closedAt, fee: request.fee };
      await tables.replace(TICKETS_TABLE, request.ticketId, closed);
      await rememberAnswer(tables, request.requestKey, request.ticketId);
      return succeed(closed);
    });
  }

  changePaymentStatus(tables: TableAccess, request: PaymentStatusRequest): Promise<Result<Ticket, PaymentStatusRefusal>> {
    return this.oneStepAtATime.run(async () => {
      const earlier = await this.findByRequestKey(tables, request.requestKey);
      if (earlier !== undefined) {
        return succeed(earlier);
      }
      const current = await this.findById(tables, request.ticketId);
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
      await tables.replace(TICKETS_TABLE, request.ticketId, changed);
      await rememberAnswer(tables, request.requestKey, request.ticketId);
      return succeed(changed);
    });
  }
}

function openTicketsAt(tickets: readonly Ticket[], siteId: SiteId): number {
  return tickets.filter((ticket) => ticket.state === 'open' && ticket.siteId === siteId).length;
}

function rememberAnswer(tables: TableAccess, requestKey: string, ticketId: TicketId): Promise<void> {
  const answer: RequestKeyRow = { ticketId };
  return tables.insert(TICKET_REQUEST_KEYS_TABLE, requestKey, answer);
}
