/**
 * The Driver App's view of ticket open and close by scan.
 * The real adapter will call the main system's HTTP entry point; tests use an in-memory stand-in.
 * The app holds no ticket rules: it only sends what the driver scanned and shows what the server returned.
 */
import type { SiteId, TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';

export interface OpenTicketScanInput {
  readonly requestId: RequestId;
  readonly siteId: SiteId;
  readonly entryCode: string;
}

export interface CloseTicketScanInput {
  readonly requestId: RequestId;
  readonly ticketId: TicketId;
  readonly siteId: SiteId;
  readonly exitCode: string;
}

export interface OpenedTicketScan {
  readonly ticketId: TicketId;
  readonly siteId: SiteId;
  readonly status: 'opened';
}

export interface ClosedTicketScan {
  readonly ticketId: TicketId;
  readonly siteId: SiteId;
  readonly status: 'closed';
}

export type TicketScanRefusal =
  | 'car already parked'
  | 'no open ticket'
  | 'forged code'
  | 'wrong site'
  | 'site closed'
  | 'site full';

export class TicketScanTransportError extends Error {
  constructor(message = 'connection lost before the answer arrived') {
    super(message);
    this.name = 'TicketScanTransportError';
  }
}

export interface TicketScanApi {
  openTicket(input: OpenTicketScanInput): Promise<OpenedTicketScan>;
  closeTicket(input: CloseTicketScanInput): Promise<ClosedTicketScan>;
}
