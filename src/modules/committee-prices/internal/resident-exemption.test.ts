import { describe, expect, it } from 'vitest';
import { createFeeCalculator, type PriceVersion } from '../public';

/**
 * Task B4: a car registered to a street address at a site pays 0 at that site.
 *
 * Where the registrations live is not decided yet, so the calculator is handed one question to ask: is this car
 * registered at this site? These tests answer it with a small fake.
 */

function priceVersion(overrides: Partial<PriceVersion> = {}): PriceVersion {
  return {
    versionId: 'version-1',
    siteId: 'site-1',
    firstHourFee: 10,
    eachLaterHourFee: 5,
    dailyCap: 50,
    validFrom: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function at(hour: number, minute = 0, day = 9): Date {
  return new Date(Date.UTC(2026, 10, day, hour, minute));
}

const registrations: Readonly<Record<string, readonly string[]>> = {
  'car-resident': ['site-1'],
  'car-resident-elsewhere': ['site-2'],
};

const calculator = createFeeCalculator({
  isResident: async (carRef, siteId) => registrations[carRef]?.includes(siteId) ?? false,
});

describe('B4 the resident exemption', () => {
  it('charges a resident car 0: 10:00 to 12:00 gives 0', async () => {
    expect(await calculator.computeFeeForCar({ carRef: 'car-resident' }, at(10), at(12), priceVersion())).toBe(0);
  });

  it('charges a car that is not registered the normal fee for the same stay: 10:00 to 12:00 gives 15', async () => {
    expect(await calculator.computeFeeForCar({ carRef: 'car-other' }, at(10), at(12), priceVersion())).toBe(15);
  });

  it('charges 0 for a resident even past the daily cap', async () => {
    expect(await calculator.computeFeeForCar({ carRef: 'car-resident' }, at(10), at(10, 0, 12), priceVersion())).toBe(0);
  });

  it('exempts a car only at the site it is registered to', async () => {
    const elsewhere = calculator.computeFeeForCar({ carRef: 'car-resident-elsewhere' }, at(10), at(12), priceVersion());
    expect(await elsewhere).toBe(15);
    const registeredHere = calculator.computeFeeForCar({ carRef: 'car-resident-elsewhere' }, at(10), at(12), priceVersion({ siteId: 'site-2' }));
    expect(await registeredHere).toBe(0);
  });

  it('asks about the car and the site of the price version', async () => {
    const asked: Array<[string, string]> = [];
    const spy = createFeeCalculator({
      isResident: async (carRef, siteId) => {
        asked.push([carRef, siteId]);
        return false;
      },
    });
    await spy.computeFeeForCar({ carRef: 'car-x' }, at(10), at(11), priceVersion({ siteId: 'site-9' }));
    expect(asked).toEqual([['car-x', 'site-9']]);
  });

  it('charges the normal fee when the check cannot answer', async () => {
    const broken = createFeeCalculator({
      isResident: async () => {
        throw new Error('registrations unavailable');
      },
    });
    expect(await broken.computeFeeForCar({ carRef: 'car-resident' }, at(10), at(12), priceVersion())).toBe(15);
  });

  it('charges the normal fee when the check throws at once', async () => {
    const broken = createFeeCalculator({
      isResident: () => {
        throw new Error('registrations unavailable');
      },
    });
    expect(await broken.computeFeeForCar({ carRef: 'car-resident' }, at(10), at(12), priceVersion())).toBe(15);
  });

  it('charges the normal fee for everyone when no check is supplied', async () => {
    const plain = createFeeCalculator();
    expect(await plain.computeFeeForCar({ carRef: 'car-resident' }, at(10), at(12), priceVersion())).toBe(15);
  });

  it('exempts only on a clear yes', async () => {
    const vague = createFeeCalculator({ isResident: (() => 'yes') as unknown as () => boolean });
    expect(await vague.computeFeeForCar({ carRef: 'car-resident' }, at(10), at(12), priceVersion())).toBe(15);
  });

  it('still gives a whole number from 0 up to the cap for a car that is not registered', async () => {
    const fee = await calculator.computeFeeForCar({ carRef: 'car-other' }, at(12), at(10), priceVersion());
    expect(fee).toBe(0);
  });
});
