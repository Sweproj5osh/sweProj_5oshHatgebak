import type { FeeCalculator, Money, PriceVersion } from '../public';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * Pure fee arithmetic (Rule C: no other module computes a fee). A stay is charged per started hour: the first hour
 * costs the first-hour fee, every later started hour costs the later-hour fee, and the total never goes above the
 * daily cap of the price version. One cap applies to the whole ticket.
 *
 * The result is always a whole number of pounds from 0 up to the cap, for any input (fitness function F4). A stay of
 * zero length, an exit before the entry, an invalid date or a negative cap all give 0. Ticketing is responsible for
 * refusing to close a ticket whose exit time is before its entry time, so that a clock fault is not charged as 0.
 */
export function createFeeCalculator(): FeeCalculator {
  return {
    computeFee(entry: Date, exit: Date, version: PriceVersion): Money {
      const stayInMilliseconds = exit.getTime() - entry.getTime();
      if (!(stayInMilliseconds > 0)) {
        return 0;
      }
      const startedHours = Math.ceil(stayInMilliseconds / MILLISECONDS_PER_HOUR);
      const uncappedFee = version.firstHourFee + (startedHours - 1) * version.eachLaterHourFee;
      const cappedFee = Math.min(uncappedFee, version.dailyCap);
      return Number.isFinite(cappedFee) ? Math.max(0, cappedFee) : 0;
    },

    computeResidentFee(): Money {
      return 0;
    },
  };
}
