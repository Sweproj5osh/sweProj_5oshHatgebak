import type { PriceList, PriceVersion } from '../../committee-prices/public';
import type { Clock } from '../../../shared/clock';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { Ticket } from '../public';
import { TICKETS_TABLE } from './table-ticket-store';

/**
 * What the sample bodies of the write operations name (`examples.valid`), so the audit-coverage harness (F5, P26 Q10)
 * can run them: the ticket `ticket-1` of `driver-1` with the car `car-1` at `site-1`, and a price in force there. The
 * harness signs its tokens as `<role>-1`.
 */
export const SAMPLE_SITE = 'site-1';
export const SAMPLE_CAR = 'car-1';
export const SAMPLE_TICKET = 'ticket-1';
export const SAMPLE_DRIVER = 'driver-1';
export const SAMPLE_ENTRY_CODE = `entry-${SAMPLE_SITE}`;
export const SAMPLE_EXIT_CODE = `exit-${SAMPLE_SITE}`;

const SAMPLE_PRICE: PriceVersion = {
  versionId: 'sample-price',
  siteId: SAMPLE_SITE,
  firstHourFee: 10,
  eachLaterHourFee: 5,
  dailyCap: 50,
  validFrom: '2020-01-01T00:00:00.000Z',
};
const SAMPLE_PRICE_APPROVAL = 'sample-price-approval';

export type SampleSeeder = (database: TableAccess) => Promise<void>;

/** Seeds an open ticket the close operations can close: opened now, so the sample close charges the started hours of a zero stay. */
export function openSampleTicket(dependencies: { readonly clock: Clock; readonly prices: PriceList }, assisted: boolean): SampleSeeder {
  return async (database) => {
    await ensureSamplePrice(dependencies.prices);
    const ticket: Ticket = {
      ticketId: SAMPLE_TICKET,
      siteId: SAMPLE_SITE,
      driverRef: SAMPLE_DRIVER,
      carRef: SAMPLE_CAR,
      state: 'open',
      paymentStatus: 'unpaid',
      openedAt: dependencies.clock.now().toISOString(),
      assisted,
    };
    await database.insert(TICKETS_TABLE, ticket.ticketId, ticket);
  };
}

async function ensureSamplePrice(prices: PriceList): Promise<void> {
  const known = await prices.versionValidAt(SAMPLE_SITE, new Date(SAMPLE_PRICE.validFrom));
  if (known.found) {
    return;
  }
  const outcome = await prices.applyApprovedVersion(SAMPLE_PRICE, SAMPLE_PRICE_APPROVAL);
  if (!outcome.applied) {
    throw new Error(`the sample price for the audit-coverage harness was refused: ${outcome.reason}`);
  }
}
