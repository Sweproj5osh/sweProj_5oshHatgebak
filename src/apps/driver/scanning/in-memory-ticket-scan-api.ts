/**
 * In-memory stand-in for the ticket scan HTTP API while Teammate B's TicketDesk is not yet plugged into the
 * entry point. It mirrors the server's repeatable-write rule: the same request id returns the same answer and
 * opens or closes at most once. Not a production module — tests and local prototypes only.
 */
import type { SiteId, TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';
import {
  TicketScanTransportError,
  type CloseTicketScanInput,
  type ClosedTicketScan,
  type OpenTicketScanInput,
  type OpenedTicketScan,
  type TicketScanApi,
} from './ticket-scan-api';

interface OpenRecord {
  readonly response: OpenedTicketScan;
  readonly driverKey: string;
}

export class InMemoryTicketScanApi implements TicketScanApi {
  private readonly openResponses = new Map<RequestId, OpenRecord>();
  private readonly closeResponses = new Map<RequestId, ClosedTicketScan>();
  private readonly openTicketByDriver = new Map<string, TicketId>();
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

  async openTicket(input: OpenTicketScanInput): Promise<OpenedTicketScan> {
    const known = this.openResponses.get(input.requestId);
    if (known !== undefined) {
      this.maybeDropAfterApply();
      return known.response;
    }

    const driverKey = 'current-driver';
    if (this.openTicketByDriver.has(driverKey)) {
      throw new Error('car already parked');
    }

    const expected = `entry-${input.siteId}`;
    if (input.entryCode !== expected) {
      throw new Error(input.entryCode.startsWith('exit-') ? 'wrong site' : 'forged code');
    }

    const ticketId = `ticket-${this.nextTicketNumber}`;
    this.nextTicketNumber += 1;
    const response: OpenedTicketScan = {
      ticketId,
      siteId: input.siteId,
      status: 'opened',
    };
    this.openResponses.set(input.requestId, { response, driverKey });
    this.openTicketByDriver.set(driverKey, ticketId);
    this.maybeDropAfterApply();
    return response;
  }

  async closeTicket(input: CloseTicketScanInput): Promise<ClosedTicketScan> {
    const known = this.closeResponses.get(input.requestId);
    if (known !== undefined) {
      this.maybeDropAfterApply();
      return known;
    }

    const driverKey = 'current-driver';
    const openTicketId = this.openTicketByDriver.get(driverKey);
    if (openTicketId === undefined || openTicketId !== input.ticketId) {
      throw new Error('no open ticket');
    }

    const expected = `exit-${input.siteId}`;
    if (input.exitCode !== expected) {
      throw new Error(input.exitCode.startsWith('entry-') ? 'wrong site' : 'forged code');
    }

    const response: ClosedTicketScan = {
      ticketId: input.ticketId,
      siteId: input.siteId as SiteId,
      status: 'closed',
    };
    this.closeResponses.set(input.requestId, response);
    this.openTicketByDriver.delete(driverKey);
    this.maybeDropAfterApply();
    return response;
  }

  private maybeDropAfterApply(): void {
    if (this.transportDropsRemaining <= 0) {
      return;
    }
    this.transportDropsRemaining -= 1;
    throw new TicketScanTransportError();
  }
}
