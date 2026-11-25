// Planted violation for F1: the pure module reaches outside its own folder.
import type { Ticket } from '../../ticketing/public';
import { createHash } from 'node:crypto';

export function feeFor(ticket: Ticket): string {
  return createHash('sha256').update(ticket.ticketId).digest('hex');
}
