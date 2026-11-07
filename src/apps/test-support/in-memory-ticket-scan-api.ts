/**
 * In-memory stand-in for the ticket scan data layer, for client tests that need no server (P14). It mirrors the
 * server's repeatable-write rule: the same request id returns the same answer and opens or closes at most once.
 * The codes are `entry-<site>` and `exit-<site>`; the site a code belongs to is read from the code, as the real
 * server reads it from the signed code. One open ticket per car, as Karim's store keeps it.
 */
import type { RequestId } from '../../shared/request-id';
import {
  TicketScanRefusedError,
  type CloseTicketScanInput,
  type OpenTicketScanInput,
  type ScannedTicket,
  type TicketScanApi,
} from '../shared-client/scanning/ticket-scan-api';
import { ServerTransportError } from '../shared-client/server-call';

const DRIVER = 'driver-1';
const OPENED_AT = '2026-11-09T08:00:00.000Z';
const CLOSED_AT = '2026-11-09T08:30:00.000Z';
const FIRST_HOUR_FEE = 10;

export class InMemoryTicketScanApi implements TicketScanApi {
  private readonly openAnswers = new Map<RequestId, ScannedTicket>();
  private readonly closeAnswers = new Map<RequestId, ScannedTicket>();
  private readonly openTicketByCar = new Map<string, ScannedTicket>();
  private nextTicketNumber = 1;
  private transportDropsRemaining = 0;

  /** How many tickets this stand-in has ever opened (for the D3 duplicate report). */
  ticketsOpenedCount(): number {
    return this.nextTicketNumber - 1;
  }

  /** Drop the next successful answers after the server has applied them (airplane mid-scan). */
  dropNextAnswers(count: number): void {
    this.transportDropsRemaining = count;
  }

  async openTicket(input: OpenTicketScanInput): Promise<ScannedTicket> {
    const known = this.openAnswers.get(input.requestId);
    if (known !== undefined) {
      this.maybeDropAfterApply();
      return known;
    }
    if (this.openTicketByCar.has(input.carRef)) {
      throw new TicketScanRefusedError('car already parked');
    }
    if (input.entryCode !== `entry-${input.siteId}`) {
      throw new TicketScanRefusedError(input.entryCode.startsWith('exit-') ? 'wrong site' : 'forged code');
    }

    const ticket: ScannedTicket = {
      ticketId: `ticket-${this.nextTicketNumber}`,
      siteId: input.siteId,
      driverRef: DRIVER,
      carRef: input.carRef,
      state: 'open',
      paymentStatus: 'unpaid',
      openedAt: OPENED_AT,
      assisted: false,
    };
    this.nextTicketNumber += 1;
    this.openAnswers.set(input.requestId, ticket);
    this.openTicketByCar.set(input.carRef, ticket);
    this.maybeDropAfterApply();
    return ticket;
  }

  async closeTicket(input: CloseTicketScanInput): Promise<ScannedTicket> {
    const known = this.closeAnswers.get(input.requestId);
    if (known !== undefined) {
      this.maybeDropAfterApply();
      return known;
    }
    const open = [...this.openTicketByCar.values()].find((ticket) => ticket.ticketId === input.ticketId);
    if (open === undefined) {
      throw new TicketScanRefusedError('no open ticket');
    }
    if (input.exitCode !== `exit-${open.siteId}`) {
      throw new TicketScanRefusedError(input.exitCode.startsWith('entry-') ? 'wrong site' : 'forged code');
    }

    const closed: ScannedTicket = { ...open, state: 'closed', closedAt: CLOSED_AT, fee: FIRST_HOUR_FEE };
    this.closeAnswers.set(input.requestId, closed);
    this.openTicketByCar.delete(open.carRef);
    this.maybeDropAfterApply();
    return closed;
  }

  private maybeDropAfterApply(): void {
    if (this.transportDropsRemaining <= 0) {
      return;
    }
    this.transportDropsRemaining -= 1;
    throw new ServerTransportError();
  }
}
