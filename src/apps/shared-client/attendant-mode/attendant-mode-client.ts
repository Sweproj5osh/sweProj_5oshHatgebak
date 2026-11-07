/**
 * Staff App attendant-mode client (task D5). The attendant scans the site code to clock in; the server binds the
 * session to the site it decodes from the code and answers with that site. The client keeps the request id of every
 * write until the answer arrives (Rule H) and saves nothing locally when the connection is lost (ADR-09).
 */
import type { PersonId, SiteId, TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';
import { RequestIdKeeper } from '../request-id';
import { ServerTransportError } from '../server-call';
import {
  AttendantModeRefusedError,
  type AssistedTicketSuccess,
  type AttendantClockInSuccess,
  type AttendantModeApi,
  type AttendantModeRefusal,
  type MarkPaidSuccess,
  type TicketSummary,
} from './attendant-mode-api';

export type AttendantModeClientSuccess<T> = { readonly ok: true; readonly value: T };
export type AttendantModeClientRefusal = { readonly ok: false; readonly error: AttendantModeRefusal };
export type AttendantModeClientConnectionLostOnRead = { readonly ok: false; readonly error: 'connection lost' };
export type AttendantModeClientConnectionLostOnWrite = {
  readonly ok: false;
  readonly error: 'connection lost';
  readonly requestId: RequestId;
};

export type AttendantModeClientFailure = AttendantModeClientConnectionLostOnWrite | AttendantModeClientRefusal;
export type AttendantModeClientResult<T> = AttendantModeClientSuccess<T> | AttendantModeClientFailure;
export type AttendantModeClientReadResult<T> =
  | AttendantModeClientSuccess<T>
  | AttendantModeClientConnectionLostOnRead
  | AttendantModeClientRefusal;

export interface AttendantModeClientOptions {
  readonly api: AttendantModeApi;
  /** Only tests replace the generator. */
  readonly createRequestId?: () => RequestId;
}

export class AttendantModeClient {
  private readonly api: AttendantModeApi;
  private readonly clockInRequests: RequestIdKeeper;
  private readonly assistedRequests: RequestIdKeeper;
  private readonly markPaidRequests: RequestIdKeeper;
  private siteId: SiteId | undefined;

  constructor(options: AttendantModeClientOptions) {
    this.api = options.api;
    this.clockInRequests = new RequestIdKeeper(options.createRequestId);
    this.assistedRequests = new RequestIdKeeper(options.createRequestId);
    this.markPaidRequests = new RequestIdKeeper(options.createRequestId);
  }

  /** The site the server bound the session to at clock-in; undefined until the server has answered. */
  sessionSiteId(): SiteId | undefined {
    return this.siteId;
  }

  pendingClockInRequestId(): RequestId | undefined {
    return this.clockInRequests.pendingId();
  }

  pendingAssistedRequestId(): RequestId | undefined {
    return this.assistedRequests.pendingId();
  }

  pendingMarkPaidRequestId(): RequestId | undefined {
    return this.markPaidRequests.pendingId();
  }

  /** One tap: the scanned code goes to the server; the site comes back from it, never from the phone. */
  async clockIn(siteCode: string): Promise<AttendantModeClientResult<AttendantClockInSuccess>> {
    const requestId = this.clockInRequests.idFor(siteCode);

    try {
      const result = await this.api.clockIn(siteCode, requestId);
      this.clockInRequests.settle();
      this.siteId = result.siteId;
      return { ok: true, value: result };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      this.clockInRequests.settle();
      this.siteId = undefined;
      return this.refusalOrRethrow(error);
    }
  }

  async listOpenTickets(): Promise<AttendantModeClientReadResult<readonly TicketSummary[]>> {
    if (this.siteId === undefined) {
      return { ok: false, error: 'not clocked in' };
    }

    try {
      return { ok: true, value: await this.api.listOpenTickets(this.siteId) };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost' };
      }
      return this.refusalOrRethrow(error);
    }
  }

  async listCarsWaitingForCash(): Promise<AttendantModeClientReadResult<readonly string[]>> {
    if (this.siteId === undefined) {
      return { ok: false, error: 'not clocked in' };
    }

    try {
      return { ok: true, value: await this.api.listCarsWaitingForCash(this.siteId) };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost' };
      }
      return this.refusalOrRethrow(error);
    }
  }

  async openAssistedTicket(driverId: PersonId, plate: string): Promise<AttendantModeClientResult<AssistedTicketSuccess>> {
    const siteId = this.siteId;
    if (siteId === undefined) {
      return { ok: false, error: 'not clocked in' };
    }

    const requestId = this.assistedRequests.idFor(`${siteId}\u0000${driverId}\u0000${plate}`);

    try {
      const result = await this.api.openAssistedTicket({ requestId, siteId, driverId, plate });
      this.assistedRequests.settle();
      return { ok: true, value: result };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      this.assistedRequests.settle();
      return this.refusalOrRethrow(error);
    }
  }

  async markTicketPaid(ticketId: TicketId): Promise<AttendantModeClientResult<MarkPaidSuccess>> {
    if (this.siteId === undefined) {
      return { ok: false, error: 'not clocked in' };
    }

    const requestId = this.markPaidRequests.idFor(ticketId);

    try {
      const result = await this.api.markTicketPaid(ticketId, requestId);
      this.markPaidRequests.settle();
      return { ok: true, value: result };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      this.markPaidRequests.settle();
      return this.refusalOrRethrow(error);
    }
  }

  /** A refusal from the server goes to the screen; anything else is a fault and is not hidden. */
  private refusalOrRethrow(error: unknown): AttendantModeClientRefusal {
    if (error instanceof AttendantModeRefusedError) {
      if (error.refusal === 'not clocked in' || error.refusal === 'not signed in') {
        this.siteId = undefined;
      }
      return { ok: false, error: error.refusal };
    }
    throw error;
  }
}
