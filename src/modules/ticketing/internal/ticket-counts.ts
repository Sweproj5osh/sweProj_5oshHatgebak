import type { TicketCounts, TicketingSites } from '../public';
import type { TicketStore } from './ticket-store';

/**
 * Free spaces are the site's capacity minus its open tickets, counted from the tickets every time. No counter is
 * stored anywhere, so there is nothing to drift (task B11). It never goes below 0, and an unknown site has none.
 */
export function createTicketCountsService(dependencies: {
  readonly sites: Pick<TicketingSites, 'capacityOf'>;
  readonly store: TicketStore;
}): TicketCounts {
  const { sites, store } = dependencies;
  return {
    async freeSpaces(tables, siteId) {
      const capacity = (await sites.capacityOf(siteId)) ?? 0;
      return Math.max(0, capacity - (await store.countOpen(tables, siteId)));
    },
    assistedTicketCount: (tables, siteId, year, month) => store.countAssisted(tables, siteId, year, month),
  };
}
