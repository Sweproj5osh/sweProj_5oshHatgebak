/**
 * Committee Prices — owner: Teammate B (Area 3). Must-stay-on set.
 * Dated price versions and the fee arithmetic. Pure: imports nothing outside this folder (fitness function F1),
 * so this file declares its own small types instead of using src/shared.
 */

/** Amount in Egyptian pounds, whole piastres avoided: integer pounds for now; the owner may refine. */
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

/** Read the committee's prices. Writes come only from Approvals through `applyApprovedVersion` (B3). */
export interface PriceList {
  versionValidAt(siteId: string, moment: Date): Promise<PriceVersion>;
  applyApprovedVersion(version: PriceVersion, approvalRequestId: string): Promise<void>;
}

/** Fee from entry time, exit time and a price version. No database, no network, no other module (B1, B2, B4). */
export interface FeeCalculator {
  computeFee(entry: Date, exit: Date, version: PriceVersion): Money;
  computeResidentFee(): Money;
}
