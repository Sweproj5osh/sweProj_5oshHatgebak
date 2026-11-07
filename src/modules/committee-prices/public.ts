/**
 * Committee Prices — owner: Teammate B (Area 3). Must-stay-on set.
 * Dated price versions and the fee arithmetic. Pure: imports nothing outside this folder (fitness function F1),
 * so this file declares its own small types instead of using src/shared.
 */

/** Amount in Egyptian pounds, always a whole number of pounds (decided for task B1). */
export type Money = number;

export interface PriceVersion {
  readonly versionId: string;
  readonly siteId: string;
  readonly firstHourFee: Money;
  readonly eachLaterHourFee: Money;
  readonly dailyCap: Money;
  /** ISO-8601 instant from which this version applies; set by the server when Approvals applies it. */
  readonly validFrom: string;
}

/** The answer to "which price version was valid at this moment?": the version, or the fact that no price is known. */
export type PriceLookup =
  | { readonly found: true; readonly version: PriceVersion }
  | { readonly found: false; readonly reason: 'no price known' };

export type ApplyVersionRefusal =
  | 'approval request not approved'
  | 'invalid price version'
  | 'a version already starts at that moment';

export type ApplyVersionOutcome =
  | { readonly applied: true }
  | { readonly applied: false; readonly reason: ApplyVersionRefusal };

/** Read the committee's prices. Writes come only from Approvals through `applyApprovedVersion` (B3). */
export interface PriceList {
  versionValidAt(siteId: string, moment: Date): Promise<PriceLookup>;
  applyApprovedVersion(version: PriceVersion, approvalRequestId: string): Promise<ApplyVersionOutcome>;
}

/**
 * What the price list needs from the outside. This module imports nothing outside its folder (fitness function F1),
 * so whoever wires the system together passes in the question "has the approvals area approved this request?".
 */
export interface PriceListOptions {
  readonly isApproved: (approvalRequestId: string) => boolean | Promise<boolean>;
}

/** Fee from entry time, exit time and a price version. No database, no network, no other module (B1, B2, B4). */
export interface CarAtSite {
  readonly carRef: string;
}

/**
 * The one question the calculator asks to apply the resident exemption (task B4): is this car registered to a street
 * address at this site? The module cannot import the answer (F1), so the composition root hands it in.
 */
export type IsResident = (carRef: string, siteId: string) => boolean | Promise<boolean>;

/**
 * The second question (P28 #27): is parking at this site free at this moment (a committee-declared free period, held by
 * Sites & Areas, task A9)? Asked once per started hour, at the moment that hour begins. Handed in by the composition
 * root like `isResident`; the arithmetic stays here (Rule C, F1).
 */
export type IsFreeAt = (siteId: string, moment: Date) => boolean | Promise<boolean>;

export interface FeeCalculatorOptions {
  /** Without it nobody is a resident. */
  readonly isResident?: IsResident;
  /** Without it no hour is free. */
  readonly isFreeAt?: IsFreeAt;
}

export interface FeeCalculator {
  /** The plain tariff of a stay, with no exemption and no free period: what a price table shows. */
  computeFee(entry: Date, exit: Date, version: PriceVersion): Money;
  computeResidentFee(): Money;
  /** The hours a stay is charged for: every started hour, and 0 for an empty, reversed or invalid stay. */
  startedHours(entry: Date, exit: Date): number;
  /**
   * The fee for one car at the site of the price version: 0 for a resident; for everyone else the tariff of the started
   * hours, where a started hour that begins inside a free period costs 0, capped as any stay is.
   */
  computeFeeForCar(car: CarAtSite, entry: Date, exit: Date, version: PriceVersion): Promise<Money>;
}

export { createFeeCalculator } from './internal/fee-calculator';
export { createPriceList } from './internal/price-list';
