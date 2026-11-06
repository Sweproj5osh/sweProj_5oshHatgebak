import { describe, expect, it } from 'vitest';
import { createFeeCalculator, type PriceVersion } from '../../modules/committee-prices/public';

/**
 * Tasks B1 and B2: the fee calculator, tested with plain numbers.
 *
 * This file lives outside src/modules/committee-prices on purpose. Fitness function F1 scans every file inside that
 * folder, test files included, and forbids any import from outside it, which would rule out importing the test runner.
 */

const calculator = createFeeCalculator();

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

describe('B1 the fee calculator', () => {
  describe('the examples from the task sheet, at first hour 10, each later hour 5, cap 50', () => {
    it('charges the first hour for a stay of 30 minutes: 10:00 to 10:30 gives 10', () => {
      expect(calculator.computeFee(at(10), at(10, 30), priceVersion())).toBe(10);
    });

    it('charges every started hour: 10:00 to 13:10 is four started hours and gives 25', () => {
      expect(calculator.computeFee(at(10), at(13, 10), priceVersion())).toBe(25);
    });

    it('stops at the daily cap: 10:00 to 10:00 the next day gives 50', () => {
      expect(calculator.computeFee(at(10), at(10, 0, 10), priceVersion())).toBe(50);
    });
  });

  describe('where one started hour becomes the next', () => {
    it('charges the first hour for a stay of exactly one hour', () => {
      expect(calculator.computeFee(at(10), at(11), priceVersion())).toBe(10);
    });

    it('charges a second hour as soon as the stay is one minute over one hour', () => {
      expect(calculator.computeFee(at(10), at(11, 1), priceVersion())).toBe(15);
    });

    it('charges the first hour for a stay of one minute', () => {
      expect(calculator.computeFee(at(10), at(10, 1), priceVersion())).toBe(10);
    });

    it('charges the first hour for a stay of one millisecond', () => {
      const entry = at(10);
      expect(calculator.computeFee(entry, new Date(entry.getTime() + 1), priceVersion())).toBe(10);
    });
  });

  describe('the price version decides the numbers', () => {
    it('charges nothing for a stay of zero length', () => {
      expect(calculator.computeFee(at(10), at(10), priceVersion())).toBe(0);
    });

    it('uses the later-hour fee of the version it is given', () => {
      expect(calculator.computeFee(at(10), at(13), priceVersion({ eachLaterHourFee: 8 }))).toBe(26);
    });

    it('stops exactly at the cap, never one pound above it', () => {
      expect(calculator.computeFee(at(10), at(18), priceVersion({ dailyCap: 30 }))).toBe(30);
    });

    it('charges the cap, not more, for a stay much longer than a day', () => {
      expect(calculator.computeFee(at(10), at(10, 0, 20), priceVersion())).toBe(50);
    });

    it('works with a cap lower than the first-hour fee', () => {
      expect(calculator.computeFee(at(10), at(12), priceVersion({ dailyCap: 6 }))).toBe(6);
    });

    it('works when every later hour is free', () => {
      expect(calculator.computeFee(at(10), at(16), priceVersion({ eachLaterHourFee: 0 }))).toBe(10);
    });
  });

  describe('input that makes no sense still gives a valid fee, never below zero', () => {
    it('charges nothing when the exit time is before the entry time', () => {
      expect(calculator.computeFee(at(12), at(10), priceVersion())).toBe(0);
    });

    it('charges nothing when a date is invalid', () => {
      expect(calculator.computeFee(new Date('not a date'), at(10), priceVersion())).toBe(0);
      expect(calculator.computeFee(at(10), new Date('not a date'), priceVersion())).toBe(0);
    });

    it('charges nothing when the cap in the version is negative', () => {
      expect(calculator.computeFee(at(10), at(12), priceVersion({ dailyCap: -5 }))).toBe(0);
    });
  });

  describe('the resident exemption', () => {
    it('gives a fee of 0 for a resident', () => {
      expect(calculator.computeResidentFee()).toBe(0);
    });
  });

  it('reports the number of computations per second', () => {
    const version = priceVersion();
    const entry = at(10);
    const exit = at(13, 10);
    const computations = 500_000;
    const started = performance.now();
    let checksum = 0;
    for (let count = 0; count < computations; count += 1) {
      checksum += calculator.computeFee(entry, exit, version);
    }
    const seconds = (performance.now() - started) / 1000;
    expect(checksum).toBe(25 * computations);
    console.log(`B1 report: computations per second ${Math.round(computations / seconds).toLocaleString('en-US')}`);
  });
});

/** A small seeded random number generator, so a failing random case can be reproduced exactly (Mulberry32). */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe('B2 the cap guarantee (fitness function F4)', () => {
  it('never returns a fee above the cap or below zero for 1,000 random time pairs and price versions', () => {
    const random = createSeededRandom(20261106);
    const randomWholePounds = (largest: number): number => Math.floor(random() * (largest + 1));
    const baseTime = Date.UTC(2026, 10, 1);
    const casesToRun = 1000;
    let violations = 0;

    for (let count = 0; count < casesToRun; count += 1) {
      const entry = new Date(baseTime + Math.floor(random() * 30 * 24 * 3600 * 1000));
      // Offsets run from 10 hours before the entry to 60 hours after it, so some exits are before the entry.
      const exit = new Date(entry.getTime() + Math.floor((random() * 70 - 10) * 3600 * 1000));
      const version = priceVersion({
        firstHourFee: randomWholePounds(40),
        eachLaterHourFee: randomWholePounds(20),
        dailyCap: randomWholePounds(100),
      });

      const fee = calculator.computeFee(entry, exit, version);
      if (fee > version.dailyCap || fee < 0 || !Number.isInteger(fee)) {
        violations += 1;
      }
    }

    console.log(`B2 report: cases run ${casesToRun}; violations ${violations}`);
    expect(violations).toBe(0);
  });
});
