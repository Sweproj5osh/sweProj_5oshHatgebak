/**
 * Staff App attendant-mode client (task D5, the shell): the attendant scans the site code to clock in; the server
 * binds the session to the site it decodes from the code and answers with that site. The client keeps the request id
 * until the answer arrives (Rule H) and saves nothing locally when the connection is lost (ADR-09).
 */
import type { SiteId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';
import { RequestIdKeeper } from '../request-id';
import { ServerTransportError } from '../server-call';
import { AttendantModeRefusedError, type AttendantClockInSuccess, type AttendantModeApi, type AttendantModeRefusal } from './attendant-mode-api';

export type AttendantModeClientSuccess<T> = { readonly ok: true; readonly value: T };
export type AttendantModeClientFailure =
  | { readonly ok: false; readonly error: 'connection lost'; readonly requestId: RequestId }
  | { readonly ok: false; readonly error: AttendantModeRefusal };
export type AttendantModeClientResult<T> = AttendantModeClientSuccess<T> | AttendantModeClientFailure;

export interface AttendantModeClientOptions {
  readonly api: AttendantModeApi;
  /** Only tests replace the generator. */
  readonly createRequestId?: () => RequestId;
}

export class AttendantModeClient {
  private readonly api: AttendantModeApi;
  private readonly clockInRequests: RequestIdKeeper;
  private siteId: SiteId | undefined;

  constructor(options: AttendantModeClientOptions) {
    this.api = options.api;
    this.clockInRequests = new RequestIdKeeper(options.createRequestId);
  }

  /** The site the server bound the session to at clock-in; undefined until the server has answered. */
  sessionSiteId(): SiteId | undefined {
    return this.siteId;
  }

  pendingClockInRequestId(): RequestId | undefined {
    return this.clockInRequests.pendingId();
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
      return refusalOrRethrow(error);
    }
  }
}

/** A refusal from the server goes to the screen; anything else is a fault and is not hidden. */
function refusalOrRethrow(error: unknown): AttendantModeClientFailure {
  if (error instanceof AttendantModeRefusedError) {
    return { ok: false, error: error.refusal };
  }
  throw error;
}
