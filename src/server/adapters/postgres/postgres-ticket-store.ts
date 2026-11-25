import { TableTicketStore, type Ticket } from '../../modules/parking-and-prices/ticketing/index';
import type { Result } from '../../shared/result';
import type { TableAccess } from '../../shared/unit-of-work';
import { PostgresTransaction } from './postgres-database';

/** The first half of the two-number advisory lock that guards one site's last spaces ("TI", ticketing). */
const SITE_LOCK_NAMESPACE = 0x5449;

/**
 * Ticketing's table store with the guard its contract asks of the PostgreSQL adapter (TicketStore, `openIfPossible`):
 * deciding capacity and inserting the ticket happen under a transaction-scoped advisory lock on the site, so two
 * transactions, in one server copy or several, never both see the last space (task B6, Rule E, fitness function F3).
 * Different sites never wait for each other. Everything else is TableTicketStore unchanged.
 */
export class PostgresTicketStore extends TableTicketStore {
  override async openIfPossible(tables: TableAccess, request: Parameters<TableTicketStore['openIfPossible']>[1]): Promise<Result<Ticket, 'car already parked' | 'site full'>> {
    if (tables instanceof PostgresTransaction) {
      await tables.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [SITE_LOCK_NAMESPACE, request.ticket.siteId]);
    }
    return super.openIfPossible(tables, request);
  }
}
