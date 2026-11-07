import type { CarAtSite, FeeCalculator, FeeCalculatorOptions, Money, PriceVersion } from '../public';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * Pure fee arithmetic (Rule C: no other module computes a fee). A stay is charged per started hour: the first hour
 * costs the first-hour fee, every later started hour costs the later-hour fee, and the total never goes above the
 * daily cap of the price version. One cap applies to the whole ticket. A started hour that begins inside a free period
 * of the site costs nothing (P28 #27); the cap still applies to what remains.
 *
 * The result is always a whole number of pounds from 0 up to the cap, for any input (fitness function F4). A stay of
 * zero length, an exit before the entry, an invalid date or a negative cap all give 0. Ticketing is responsible for
 * refusing to close a ticket whose exit time is before its entry time, so that a clock fault is not charged as 0.
 */
export function createFeeCalculator(options: FeeCalculatorOptions = {}): FeeCalculator {
  const calculator: FeeCalculator = {
    startedHours(entry: Date, exit: Date): number {
      const stayInMilliseconds = exit.getTime() - entry.getTime();
      return stayInMilliseconds > 0 ? Math.ceil(stayInMilliseconds / MILLISECONDS_PER_HOUR) : 0;
    },

    computeFee(entry: Date, exit: Date, version: PriceVersion): Money {
      return feeForChargedHours(everyHourOf(calculator.startedHours(entry, exit)), version);
    },

    computeResidentFee(): Money {
      return 0;
    },

    async computeFeeForCar(car: CarAtSite, entry: Date, exit: Date, version: PriceVersion): Promise<Money> {
      if (await isClearlyResident(options, car.carRef, version.siteId)) {
        return calculator.computeResidentFee();
      }
      const charged = await hoursNotFree(options, entry, calculator.startedHours(entry, exit), version.siteId);
      return feeForChargedHours(charged, version);
    },
  };
  return calculator;
}

/** The started hours of a stay as positions 0, 1, 2, …: position 0 is the first hour. */
function everyHourOf(startedHours: number): readonly number[] {
  return Array.from({ length: startedHours }, (_, position) => position);
}

/**
 * The positions of the started hours that do not begin inside a free period, asked one by one at the moment each hour
 * begins. Without an `isFreeAt` question no hour is free. Only a clear yes frees an hour.
 */
async function hoursNotFree(options: FeeCalculatorOptions, entry: Date, startedHours: number, siteId: string): Promise<readonly number[]> {
  const { isFreeAt } = options;
  if (isFreeAt === undefined) {
    return everyHourOf(startedHours);
  }
  const charged: number[] = [];
  for (const position of everyHourOf(startedHours)) {
    const hourBegins = new Date(entry.getTime() + position * MILLISECONDS_PER_HOUR);
    if ((await isFreeAt(siteId, hourBegins)) !== true) {
      charged.push(position);
    }
  }
  return charged;
}

/** Position 0 costs the first-hour fee, every later position the later-hour fee; the sum is capped and never below 0. */
function feeForChargedHours(positions: readonly number[], version: PriceVersion): Money {
  const uncappedFee = positions.reduce((sum, position) => sum + (position === 0 ? version.firstHourFee : version.eachLaterHourFee), 0);
  const cappedFee = Math.min(uncappedFee, version.dailyCap);
  return Number.isFinite(cappedFee) ? Math.max(0, cappedFee) : 0;
}

/**
 * Only a clear yes exempts. A check that cannot answer, or answers anything but true, charges the normal fee: a
 * wrongly charged resident can be refunded, while a wrongly exempted car is lost money nobody notices.
 */
async function isClearlyResident(options: FeeCalculatorOptions, carRef: string, siteId: string): Promise<boolean> {
  if (options.isResident === undefined) {
    return false;
  }
  try {
    return (await options.isResident(carRef, siteId)) === true;
  } catch {
    return false;
  }
}
