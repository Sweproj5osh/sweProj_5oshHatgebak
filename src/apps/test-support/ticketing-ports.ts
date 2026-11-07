/**
 * What a data-layer test fills into the composed ticketing module beyond the test application's own stand-ins (P14):
 * a committee price for a site, so a close can charge a fee, and a plate for a car, so a receipt can print it. The
 * operations under test are the ones the server runs; only these two ports are the test's.
 */
import { createPriceList, type PriceList, type PriceVersion } from '../../modules/committee-prices/public';
import type { PlateLookup } from '../../modules/ticketing/public';
import { fail, succeed } from '../../shared/result';

/** The price every site in a test charges: ten pounds for the first hour, five for each later one, fifty a day. */
export const TEST_PRICE = { firstHourFee: 10, eachLaterHourFee: 5, dailyCap: 50 };

export async function priceListFor(siteIds: readonly string[]): Promise<PriceList> {
  const prices = createPriceList({ isApproved: () => true });
  for (const siteId of siteIds) {
    const version: PriceVersion = { versionId: `price-${siteId}`, siteId, ...TEST_PRICE, validFrom: '2026-11-01T00:00:00.000Z' };
    const outcome = await prices.applyApprovedVersion(version, `approval-${siteId}`);
    if (!outcome.applied) {
      throw new Error(`the test price for ${siteId} was refused: ${outcome.reason}`);
    }
  }
  return prices;
}

export function platesFor(plateOfCar: Readonly<Record<string, string>>): PlateLookup {
  return {
    readPlate: async ({ carRef }) => {
      const plate = plateOfCar[carRef];
      return plate === undefined ? fail('not resolvable') : succeed(plate);
    },
  };
}
