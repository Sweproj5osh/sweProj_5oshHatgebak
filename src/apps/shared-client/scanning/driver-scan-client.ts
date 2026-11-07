/**
 * Driver App scanning client (task D3).
 * Collects the scanned code, keeps one request id until the server answers, and retries with that same id
 * when the connection drops mid-scan. Ticket decisions stay on the server (Rule A): the client shows the server's
 * refusal and never judges a code, a site or a ticket itself.
 *
 * A request id is kept only while the retry is for the same scan. A different code or site is a different request
 * and gets a new id, so a retry can never silently send an older scan in place of the one the driver just made.
 */
import type { TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';
import { RequestIdKeeper } from '../request-id';
import { ServerTransportError } from '../server-call';
import { TicketScanRefusedError, type OpenTicketScanInput, type ScannedTicket, type TicketScanApi, type TicketScanRefusal } from './ticket-scan-api';

export type DriverScanClientSuccess<T> = { readonly ok: true; readonly value: T };
export type DriverScanClientRefusal = { readonly ok: false; readonly error: TicketScanRefusal };
export type DriverScanClientFailure =
  | { readonly ok: false; readonly error: 'connection lost'; readonly requestId: RequestId }
  | DriverScanClientRefusal;
export type DriverScanClientResult<T> = DriverScanClientSuccess<T> | DriverScanClientFailure;

export interface DriverScanClientOptions {
  readonly api: TicketScanApi;
  /** Only tests replace the generator. */
  readonly createRequestId?: () => RequestId;
}

/** What the driver scanned: the site, the car they chose from their cars, and the code printed at the entrance. */
export type EntryScan = Omit<OpenTicketScanInput, 'requestId'>;

/** A scan that is running now, so a second tap on the same scan joins it instead of sending again. */
interface InFlight<T> {
  readonly input: string;
  readonly result: Promise<DriverScanClientResult<T>>;
}

export class DriverScanClient {
  private readonly api: TicketScanApi;
  private readonly openRequests: RequestIdKeeper;
  private readonly closeRequests: RequestIdKeeper;
  private activeTicketId: TicketId | undefined;
  private inFlightEntry: InFlight<ScannedTicket> | undefined;
  private inFlightExit: InFlight<ScannedTicket> | undefined;

  constructor(options: DriverScanClientOptions) {
    this.api = options.api;
    this.openRequests = new RequestIdKeeper(options.createRequestId);
    this.closeRequests = new RequestIdKeeper(options.createRequestId);
  }

  /** The open ticket from the last successful entry scan, if any. */
  activeTicket(): TicketId | undefined {
    return this.activeTicketId;
  }

  /** Request id held until the entry answer arrives; undefined when idle. */
  pendingEntryRequestId(): RequestId | undefined {
    return this.openRequests.pendingId();
  }

  /** Request id held until the exit answer arrives; undefined when idle. */
  pendingExitRequestId(): RequestId | undefined {
    return this.closeRequests.pendingId();
  }

  /**
   * Open a ticket from an entry code. A second tap on the same scan before the answer arrives joins the same
   * in-flight call and the same request id. A transport failure keeps that request id so a retry cannot create a
   * second ticket. A scan of a different code waits for the running one, then is sent on its own.
   */
  scanEntry(scan: EntryScan): Promise<DriverScanClientResult<ScannedTicket>> {
    const input = `${scan.siteId}\u0000${scan.carRef}\u0000${scan.entryCode}`;
    const running = this.inFlightEntry;
    if (running?.input === input) {
      return running.result;
    }

    const start = () => this.runEntryScan(scan, input);
    const result: Promise<DriverScanClientResult<ScannedTicket>> = (
      running === undefined ? start() : running.result.then(start, start)
    ).finally(() => {
      if (this.inFlightEntry?.result === result) {
        this.inFlightEntry = undefined;
      }
    });
    this.inFlightEntry = { input, result };
    return result;
  }

  /**
   * Close the active ticket from an exit code. Keeps one request id across connection-loss retries.
   * With no open ticket there is nothing to send, so the answer is the same refusal the server would give.
   */
  scanExit(exitCode: string): Promise<DriverScanClientResult<ScannedTicket>> {
    const ticketId = this.activeTicketId;
    if (ticketId === undefined) {
      return Promise.resolve({ ok: false, error: 'no open ticket' });
    }

    const input = `${ticketId}\u0000${exitCode}`;
    const running = this.inFlightExit;
    if (running?.input === input) {
      return running.result;
    }

    const start = () => this.runExitScan(ticketId, exitCode, input);
    const result: Promise<DriverScanClientResult<ScannedTicket>> = (
      running === undefined ? start() : running.result.then(start, start)
    ).finally(() => {
      if (this.inFlightExit?.result === result) {
        this.inFlightExit = undefined;
      }
    });
    this.inFlightExit = { input, result };
    return result;
  }

  private async runEntryScan(scan: EntryScan, input: string): Promise<DriverScanClientResult<ScannedTicket>> {
    const requestId = this.openRequests.idFor(input);

    try {
      const opened = await this.api.openTicket({ requestId, ...scan });
      this.activeTicketId = opened.ticketId;
      this.openRequests.settle();
      return { ok: true, value: opened };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      this.openRequests.settle();
      return refusalOrRethrow(error);
    }
  }

  private async runExitScan(ticketId: TicketId, exitCode: string, input: string): Promise<DriverScanClientResult<ScannedTicket>> {
    const requestId = this.closeRequests.idFor(input);

    try {
      const closed = await this.api.closeTicket({ requestId, ticketId, exitCode });
      this.activeTicketId = undefined;
      this.closeRequests.settle();
      return { ok: true, value: closed };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      this.closeRequests.settle();
      const refusal = refusalOrRethrow(error);
      if (refusal.error === 'no open ticket') {
        this.activeTicketId = undefined;
      }
      return refusal;
    }
  }
}

/** A refusal from the server goes to the screen; anything else is a fault and is not hidden. */
function refusalOrRethrow(error: unknown): DriverScanClientRefusal {
  if (error instanceof TicketScanRefusedError) {
    return { ok: false, error: error.refusal };
  }
  throw error;
}