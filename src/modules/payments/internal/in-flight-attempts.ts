import type { TicketId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';

/**
 * The per-ticket lock of the ledger (P18, integrity rank 1: never two charges). Two units of work on one ticket cannot
 * see each other's uncommitted attempt row, so the module remembers, per process, which ticket has an attempt in
 * flight. The first caller claims the ticket; a second caller under another request id is refused until the attempt
 * is settled; the same request id may come back (a retry after a rolled-back commit) and keeps its claim.
 *
 * A claim is released when the attempt refuses (its row rolls back) or when a later call finds the committed row,
 * which guards from then on. Across server copies the partial unique index of migration 0004 is the second guard.
 */
export class InFlightAttempts {
  private readonly requestIdByTicket = new Map<TicketId, RequestId>();

  /** True when this request id may charge the ticket now; false while another attempt is in flight. */
  claim(ticketId: TicketId, requestId: RequestId): boolean {
    const holder = this.requestIdByTicket.get(ticketId);
    if (holder !== undefined && holder !== requestId) {
      return false;
    }
    this.requestIdByTicket.set(ticketId, requestId);
    return true;
  }

  release(ticketId: TicketId): void {
    this.requestIdByTicket.delete(ticketId);
  }
}
