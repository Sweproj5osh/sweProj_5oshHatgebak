import type { CarAtSite, FeeCalculator, FeeCalculatorOptions, FeeForCar, Money, PriceVersion } from '../public';

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
 *
 * The two injected questions (residency, free periods) may fail. Only a clear yes exempts; a question that cannot
 * answer charges the normal fee and is named in the result's `warnings`, never swallowed: a wrongly charged driver
 * can be refunded, while a wrongly exempted car is lost money nobody notices, and a lookup that keeps failing must be
 * seen. This module imports no logger (F1), so the result carries the warning to whoever records it.
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

    async computeFeeForCar(car: CarAtSite, entry: Date, exit: Date, version: PriceVersion): Promise<FeeForCar> {
      const residency = await askResidency(options, car.carRef, version.siteId);
      if (residency.answer === true) {
        return { fee: calculator.computeResidentFee(), warnings: [] };
      }
      const charged = await hoursNotFree(options, entry, calculator.startedHours(entry, exit), version.siteId);
      return { fee: feeForChargedHours(charged.positions, version), warnings: [...residency.warnings, ...charged.warnings] };
    },
  };
  return calculator;
}

/** What an injected question gave back: its answer, or the warning that stands in for the answer it could not give. */
interface Asked<Answer> {
  readonly answer: Answer | undefined;
  readonly warnings: readonly string[];
}

/** Only a clear `true` exempts; anything else, including a failure, is "not a resident" with the failure named. */
async function askResidency(options: FeeCalculatorOptions, carRef: string, siteId: string): Promise<Asked<boolean>> {
  if (options.isResident === undefined) {
    return { answer: false, warnings: [] };
  }
  return ask('resident check', () => options.isResident?.(carRef, siteId));
}

/**
 * The positions of the started hours that do not begin inside a free period, asked one by one at the moment each hour
 * begins. Without an `isFreeAt` question no hour is free. When the question fails, that hour and every later one are
 * charged and the failure is named once.
 */
async function hoursNotFree(options: FeeCalculatorOptions, entry: Date, startedHours: number, siteId: string): Promise<{ positions: readonly number[]; warnings: readonly string[] }> {
  const { isFreeAt } = options;
  const positions = everyHourOf(startedHours);
  if (isFreeAt === undefined) {
    return { positions, warnings: [] };
  }
  const charged: number[] = [];
  for (const position of positions) {
    const hourBegins = new Date(entry.getTime() + position * MILLISECONDS_PER_HOUR);
    const asked = await ask('free period check', () => isFreeAt(siteId, hourBegins));
    if (asked.warnings.length > 0) {
      return { positions: [...charged, ...positions.slice(position)], warnings: asked.warnings };
    }
    if (asked.answer !== true) {
      charged.push(position);
    }
  }
  return { positions: charged, warnings: [] };
}

async function ask(question: string, lookup: () => boolean | Promise<boolean> | undefined): Promise<Asked<boolean>> {
  try {
    return { answer: (await lookup()) === true, warnings: [] };
  } catch (error) {
    return { answer: undefined, warnings: [`${question} failed, normal fee charged: ${describe(error)}`] };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The started hours of a stay as positions 0, 1, 2, …: position 0 is the first hour. */
function everyHourOf(startedHours: number): readonly number[] {
  return Array.from({ length: startedHours }, (_, position) => position);
}

/** Position 0 costs the first-hour fee, every later position the later-hour fee; the sum is capped and never below 0. */
function feeForChargedHours(positions: readonly number[], version: PriceVersion): Money {
  const uncappedFee = positions.reduce((sum, position) => sum + (position === 0 ? version.firstHourFee : version.eachLaterHourFee), 0);
  const cappedFee = Math.min(uncappedFee, version.dailyCap);
  return Number.isFinite(cappedFee) ? Math.max(0, cappedFee) : 0;
}
