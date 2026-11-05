/**
 * Driver App scanning client (task D3).
 * Collects the scanned code, keeps one request id until the server answers, and retries with that same id
 * when the connection drops mid-scan. Ticket decisions stay on the server (Rule A).
 */
import type { SiteId, TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';
import {
  TicketScanTransportError,
  type ClosedTicketScan,
  type OpenedTicketScan,
  type TicketScanApi,
} from './ticket-scan-api';

export type DriverScanClientSuccess<T> = { readonly ok: true; readonly value: T };
export type DriverScanClientFailure = {
  readonly ok: false;
  readonly error: 'connection lost';
  readonly requestId: RequestId;
};
export type DriverScanClientResult<T> = DriverScanClientSuccess<T> | DriverScanClientFailure;

export interface DriverScanClientOptions {
  readonly api: TicketScanApi;
  /** Creates a new client request id when a scan starts and none is pending. */
  readonly createRequestId: () => RequestId;
}

interface PendingOpen {
  readonly requestId: RequestId;
  readonly siteId: SiteId;
  readonly entryCode: string;
}

interface PendingClose {
  readonly requestId: RequestId;
  readonly ticketId: TicketId;
  readonly siteId: SiteId;
  readonly exitCode: string;
}

export class DriverScanClient {
  private readonly api: TicketScanApi;
  private readonly createRequestId: () => RequestId;
  private pendingOpen: PendingOpen | undefined;
  private pendingClose: PendingClose | undefined;
  private activeTicketId: TicketId | undefined;
  private inFlightEntry: Promise<DriverScanClientResult<OpenedTicketScan>> | undefined;
  private inFlightExit: Promise<DriverScanClientResult<ClosedTicketScan>> | undefined;

  constructor(options: DriverScanClientOptions) {
    this.api = options.api;
    this.createRequestId = options.createRequestId;
  }

  /** The open ticket from the last successful entry scan, if any. */
  activeTicket(): TicketId | undefined {
    return this.activeTicketId;
  }

  /** Request id held until the entry answer arrives; undefined when idle. */
  pendingEntryRequestId(): RequestId | undefined {
    return this.pendingOpen?.requestId;
  }

  /** Request id held until the exit answer arrives; undefined when idle. */
  pendingExitRequestId(): RequestId | undefined {
    return this.pendingClose?.requestId;
  }

  /**
   * Open a ticket from an entry code. A second tap before the answer arrives joins the same in-flight call
   * and the same request id. A transport failure keeps that request id so a retry cannot create a second ticket.
   */
  scanEntry(siteId: SiteId, entryCode: string): Promise<DriverScanClientResult<OpenedTicketScan>> {
    if (this.inFlightEntry !== undefined) {
      return this.inFlightEntry;
    }

    this.inFlightEntry = this.runEntryScan(siteId, entryCode).finally(() => {
      this.inFlightEntry = undefined;
    });
    return this.inFlightEntry;
  }

  /**
   * Close the active ticket from an exit code. Keeps one request id across connection-loss retries.
   */
  scanExit(siteId: SiteId, exitCode: string): Promise<DriverScanClientResult<ClosedTicketScan>> {
    if (this.inFlightExit !== undefined) {
      return this.inFlightExit;
    }

    this.inFlightExit = this.runExitScan(siteId, exitCode).finally(() => {
      this.inFlightExit = undefined;
    });
    return this.inFlightExit;
  }

  private async runEntryScan(
    siteId: SiteId,
    entryCode: string,
  ): Promise<DriverScanClientResult<OpenedTicketScan>> {
    if (this.pendingOpen === undefined) {
      this.pendingOpen = {
        requestId: this.createRequestId(),
        siteId,
        entryCode,
      };
    }

    try {
      const opened = await this.api.openTicket({
        requestId: this.pendingOpen.requestId,
        siteId: this.pendingOpen.siteId,
        entryCode: this.pendingOpen.entryCode,
      });
      this.activeTicketId = opened.ticketId;
      this.pendingOpen = undefined;
      return { ok: true, value: opened };
    } catch (error) {
      if (error instanceof TicketScanTransportError) {
        return { ok: false, error: 'connection lost', requestId: this.pendingOpen.requestId };
      }
      this.pendingOpen = undefined;
      throw error;
    }
  }

  private async runExitScan(
    siteId: SiteId,
    exitCode: string,
  ): Promise<DriverScanClientResult<ClosedTicketScan>> {
    const ticketId = this.activeTicketId;
    if (ticketId === undefined) {
      throw new Error('no open ticket to close; scan entry first');
    }

    if (this.pendingClose === undefined) {
      this.pendingClose = {
        requestId: this.createRequestId(),
        ticketId,
        siteId,
        exitCode,
      };
    }

    try {
      const closed = await this.api.closeTicket({
        requestId: this.pendingClose.requestId,
        ticketId: this.pendingClose.ticketId,
        siteId: this.pendingClose.siteId,
        exitCode: this.pendingClose.exitCode,
      });
      this.activeTicketId = undefined;
      this.pendingClose = undefined;
      return { ok: true, value: closed };
    } catch (error) {
      if (error instanceof TicketScanTransportError) {
        return { ok: false, error: 'connection lost', requestId: this.pendingClose.requestId };
      }
      this.pendingClose = undefined;
      throw error;
    }
  }
}
