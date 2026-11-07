import type {
  ApplyVersionOutcome,
  PriceList,
  PriceListOptions,
  PriceLookup,
  PriceVersion,
} from '../public';

/** One stored version together with the moment it starts, as milliseconds, so lookups never parse text. */
interface StoredVersion {
  readonly startsAtMilliseconds: number;
  readonly version: PriceVersion;
}

/**
 * The committee's dated price versions, kept per site and sorted by start moment (task B3).
 *
 * A version is never edited: a price change is a new version with a later start. A lookup returns the version with the
 * latest start that is not after the asked moment. A new version is accepted only when the approvals check passes,
 * and `applyApprovedVersion` is the only way to add one.
 *
 * This first adapter keeps the versions in memory. A database-backed one replaces it later without changing the
 * interface.
 */
export function createPriceList(options: PriceListOptions): PriceList {
  const versionsBySite = new Map<string, StoredVersion[]>();

  return {
    async versionValidAt(siteId: string, moment: Date): Promise<PriceLookup> {
      const momentInMilliseconds = moment.getTime();
      const versions = versionsBySite.get(siteId);
      if (versions === undefined || Number.isNaN(momentInMilliseconds)) {
        return noPriceKnown;
      }
      const position = indexOfLastStartingAtOrBefore(versions, momentInMilliseconds);
      const stored = versions[position];
      return stored === undefined ? noPriceKnown : { found: true, version: stored.version };
    },

    async applyApprovedVersion(version: PriceVersion, approvalRequestId: string): Promise<ApplyVersionOutcome> {
      if (approvalRequestId === '' || !(await options.isApproved(approvalRequestId))) {
        return { applied: false, reason: 'approval request not approved' };
      }
      if (!isWellFormed(version)) {
        return { applied: false, reason: 'invalid price version' };
      }

      // Everything below runs without waiting, so two versions arriving together cannot both pass the check.
      const startsAtMilliseconds = Date.parse(version.validFrom);
      const versions = versionsBySite.get(version.siteId) ?? [];
      const position = indexOfLastStartingAtOrBefore(versions, startsAtMilliseconds);
      if (versions[position]?.startsAtMilliseconds === startsAtMilliseconds) {
        return { applied: false, reason: 'a version already starts at that moment' };
      }
      versions.splice(position + 1, 0, { startsAtMilliseconds, version: Object.freeze({ ...version }) });
      versionsBySite.set(version.siteId, versions);
      return { applied: true };
    },
  };
}

const noPriceKnown: PriceLookup = { found: false, reason: 'no price known' };

/** The position of the last version that starts at or before the moment, or -1 when every version starts later. */
function indexOfLastStartingAtOrBefore(versions: readonly StoredVersion[], momentInMilliseconds: number): number {
  let low = 0;
  let high = versions.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const middleStart = versions[middle]?.startsAtMilliseconds;
    if (middleStart !== undefined && middleStart <= momentInMilliseconds) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function isWellFormed(version: PriceVersion): boolean {
  return (
    version.siteId !== '' &&
    version.versionId !== '' &&
    !Number.isNaN(Date.parse(version.validFrom)) &&
    isWholePounds(version.firstHourFee) &&
    isWholePounds(version.eachLaterHourFee) &&
    isWholePounds(version.dailyCap)
  );
}

function isWholePounds(amount: number): boolean {
  return Number.isInteger(amount) && amount >= 0;
}
