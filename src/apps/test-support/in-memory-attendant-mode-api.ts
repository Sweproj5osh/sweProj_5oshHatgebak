/**
 * In-memory stand-in for the Staff App attendant-mode calls, for client tests that need no server (P14). A code of
 * the form `attendant-<site>` names its site; anything else is forged. One attendant at a time, as one phone has.
 */
import type { SiteId, TicketId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import {
  AttendantModeRefusedError,
  type AssistedTicketInput,
  type AssistedTicketSuccess,
  type AttendantClockInSuccess,
  type AttendantModeApi,
  type MarkPaidSuccess,
  type TicketSummary,
} from '../shared-client/attendant-mode/attendant-mode-api';

const CODE_PREFIX = 'attendant-';

export class InMemoryAttendantModeApi implements AttendantModeApi {
  private readonly tickets = new Map<TicketId, TicketSummary>();
  private readonly clockInAnswers = new Map<RequestId, AttendantClockInSuccess>();
  private readonly assistedAnswers = new Map<RequestId, AssistedTicketSuccess>();
  private readonly paidAnswers = new Map<RequestId, MarkPaidSuccess>();
  private sessionSiteId: SiteId | undefined;
  private nextTicketNumber = 1;

  async clockIn(siteCode: string, requestId: RequestId): Promise<AttendantClockInSuccess> {
    const known = this.clockInAnswers.get(requestId);
    if (known !== undefined) {
      return known;
    }
    if (!siteCode.startsWith(CODE_PREFIX)) {
      throw new AttendantModeRefusedError('forged code');
    }
    const siteId = siteCode.slice(CODE_PREFIX.length);
    this.sessionSiteId = siteId;
    const answer: AttendantClockInSuccess = { siteId, clockedIn: true };
    this.clockInAnswers.set(requestId, answer);
    return answer;
  }

  async listOpenTickets(siteId: SiteId): Promise<readonly TicketSummary[]> {
    return [...this.tickets.values()].filter((ticket) => ticket.siteId === siteId && !ticket.paid);
  }

  async listCarsWaitingForCash(siteId: SiteId): Promise<readonly string[]> {
    return (await this.listOpenTickets(siteId)).map((ticket) => ticket.plate);
  }

  async openAssistedTicket(input: AssistedTicketInput): Promise<AssistedTicketSuccess> {
    const known = this.assistedAnswers.get(input.requestId);
    if (known !== undefined) {
      return known;
    }
    this.requireClockedInAt(input.siteId);

    const ticketId: TicketId = `ticket-${this.nextTicketNumber}`;
    this.nextTicketNumber += 1;
    const summary: TicketSummary = { ticketId, driverId: input.driverId, siteId: input.siteId, plate: input.plate, paid: false, assisted: true };
    this.tickets.set(ticketId, summary);

    const answer: AssistedTicketSuccess = { requestId: input.requestId, ...summary };
    this.assistedAnswers.set(input.requestId, answer);
    return answer;
  }

  async markTicketPaid(ticketId: TicketId, requestId: RequestId): Promise<MarkPaidSuccess> {
    const known = this.paidAnswers.get(requestId);
    if (known !== undefined) {
      return known;
    }
    const ticket = this.tickets.get(ticketId);
    if (ticket === undefined) {
      throw new AttendantModeRefusedError('ticket not found');
    }
    this.requireClockedInAt(ticket.siteId);

    this.tickets.set(ticketId, { ...ticket, paid: true });
    const answer: MarkPaidSuccess = { requestId, ticketId, paid: true };
    this.paidAnswers.set(requestId, answer);
    return answer;
  }

  /** For tests that want to assert the server state without the client. */
  getState(): ReadonlyMap<TicketId, TicketSummary> {
    return this.tickets;
  }

  private requireClockedInAt(siteId: SiteId): void {
    if (this.sessionSiteId === undefined) {
      throw new AttendantModeRefusedError('not clocked in');
    }
    if (this.sessionSiteId !== siteId) {
      throw new AttendantModeRefusedError('wrong site');
    }
  }
}
