import { describe, expect, it } from 'vitest';
import { createFeeCalculator, type PriceVersion } from '../../modules/committee-prices/public';

/**
 * P28 #27: a started hour that begins inside a free period costs 0; the cap still applies. The free periods live in
 * Sites & Areas, so the calculator is handed the one question "is this site free at this moment?" and asks it once per
 * started hour, at the moment that hour begins.
 */

function priceVersion(overrides: Partial<PriceVersion> = {}): PriceVersion {
  return { versionId: 'version-1', siteId: 'site-1', firstHourFee: 10, eachLaterHourFee: 5, dailyCap: 50, validFrom: '2026-11-01T00:00:00.000Z', ...overrides };
}

function at(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 10, 9, hour, minute));
}

/** Site-1 is free from 12:00 to 14:00 (UTC in this test); no other site has a free period. */
const freeAtMidday = createFeeCalculator({
  isFreeAt: (siteId, moment) => siteId === 'site-1' && moment.getUTCHours() >= 12 && moment.getUTCHours() < 14,
});
const car = { carRef: 'car-x' };

describe('free periods in the fee (P28 #27)', () => {
  it('charges nothing for a started hour that begins inside the free period: 11:30 to 13:30 gives 10', async () => {
    expect(await freeAtMidday.computeFeeForCar(car, at(11, 30), at(13, 30), priceVersion())).toBe(10);
  });

  it('charges 0 when the only started hour begins inside the free period: 12:15 to 13:15', async () => {
    expect(await freeAtMidday.computeFeeForCar(car, at(12, 15), at(13, 15), priceVersion())).toBe(0);
  });

  it('keeps the positions of the hours that are charged: 11:00 to 15:00 gives the first hour plus one later hour, 15', async () => {
    expect(await freeAtMidday.computeFeeForCar(car, at(11), at(15), priceVersion())).toBe(15);
  });

  it('still applies the cap to what remains: 10:00 to 16:00 with a cap of 12 gives 12', async () => {
    expect(await freeAtMidday.computeFeeForCar(car, at(10), at(16), priceVersion({ dailyCap: 12 }))).toBe(12);
  });

  it('frees hours only at the site of the price version', async () => {
    expect(await freeAtMidday.computeFeeForCar(car, at(11, 30), at(13, 30), priceVersion({ siteId: 'site-2' }))).toBe(15);
  });

  it('asks once per started hour, at the moment each hour begins, naming the site of the version', async () => {
    const asked: Array<[string, string]> = [];
    const spy = createFeeCalculator({
      isFreeAt: (siteId, moment) => {
        asked.push([siteId, moment.toISOString()]);
        return false;
      },
    });
    await spy.computeFeeForCar(car, at(11, 30), at(13, 30), priceVersion({ siteId: 'site-9' }));
    expect(asked).toEqual([
      ['site-9', at(11, 30).toISOString()],
      ['site-9', at(12, 30).toISOString()],
    ]);
  });

  it('frees nothing when no question is supplied, and frees only on a clear yes', async () => {
    expect(await createFeeCalculator().computeFeeForCar(car, at(12, 15), at(13, 15), priceVersion())).toBe(10);
    const vague = createFeeCalculator({ isFreeAt: (() => 'yes') as unknown as () => boolean });
    expect(await vague.computeFeeForCar(car, at(12, 15), at(13, 15), priceVersion())).toBe(10);
  });

  it('leaves the plain tariff alone: computeFee shows the price table without free periods', () => {
    expect(freeAtMidday.computeFee(at(11, 30), at(13, 30), priceVersion())).toBe(15);
  });

  it('a resident still pays 0 whatever the free periods say', async () => {
    const resident = createFeeCalculator({ isResident: () => true, isFreeAt: () => false });
    expect(await resident.computeFeeForCar(car, at(10), at(13), priceVersion())).toBe(0);
  });
});
