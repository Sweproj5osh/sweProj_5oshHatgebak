import { describe, expect, it } from 'vitest';
import { createPriceList, type PriceLookup, type PriceVersion } from '../../modules/committee-prices/public';

/**
 * Task B3: dated price versions. The price list returns the version valid at a given moment and accepts a new version
 * only when the approvals area vouches for it. The tests live outside src/modules/committee-prices for the same reason
 * as the fee calculator tests: fitness function F1 forbids that folder from importing the test runner.
 */

function priceVersion(overrides: Partial<PriceVersion> = {}): PriceVersion {
  return {
    versionId: 'version-1',
    siteId: 'site-1',
    firstHourFee: 10,
    eachLaterHourFee: 5,
    dailyCap: 50,
    validFrom: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const octoberVersion = priceVersion({ versionId: 'october', validFrom: '2026-10-01T00:00:00.000Z' });
const novemberVersion = priceVersion({
  versionId: 'november',
  firstHourFee: 12,
  eachLaterHourFee: 6,
  dailyCap: 60,
  validFrom: '2026-11-01T00:00:00.000Z',
});

function moment(isoText: string): Date {
  return new Date(isoText);
}

/** A price list whose approvals check accepts exactly the request ids it is given. */
function priceListApproving(...approvedRequestIds: string[]) {
  const approved = new Set(approvedRequestIds);
  return createPriceList({ isApproved: (approvalRequestId) => approved.has(approvalRequestId) });
}

/** A price list holding the October and November versions of the task sheet's example. */
async function priceListWithOctoberAndNovember() {
  const priceList = priceListApproving('approval-october', 'approval-november');
  await priceList.applyApprovedVersion(octoberVersion, 'approval-october');
  await priceList.applyApprovedVersion(novemberVersion, 'approval-november');
  return priceList;
}

function expectVersion(lookup: PriceLookup, versionId: string): void {
  expect(lookup.found).toBe(true);
  if (lookup.found) {
    expect(lookup.version.versionId).toBe(versionId);
  }
}

describe('B3 returning the version valid at a given moment', () => {
  it('returns October’s version for 15 October when versions start on 1 October and 1 November', async () => {
    const priceList = await priceListWithOctoberAndNovember();
    expectVersion(await priceList.versionValidAt('site-1', moment('2026-10-15T12:00:00.000Z')), 'october');
  });

  it('returns November’s version from the exact moment it starts', async () => {
    const priceList = await priceListWithOctoberAndNovember();
    expectVersion(await priceList.versionValidAt('site-1', moment('2026-11-01T00:00:00.000Z')), 'november');
  });

  it('still returns October’s version one millisecond before November’s version starts', async () => {
    const priceList = await priceListWithOctoberAndNovember();
    expectVersion(await priceList.versionValidAt('site-1', moment('2026-10-31T23:59:59.999Z')), 'october');
  });

  it('returns October’s version from the exact moment it starts', async () => {
    const priceList = await priceListWithOctoberAndNovember();
    expectVersion(await priceList.versionValidAt('site-1', moment('2026-10-01T00:00:00.000Z')), 'october');
  });

  it('returns the latest version for a moment long after every version started', async () => {
    const priceList = await priceListWithOctoberAndNovember();
    expectVersion(await priceList.versionValidAt('site-1', moment('2027-03-01T00:00:00.000Z')), 'november');
  });

  it('says no price is known for a moment before the first version starts', async () => {
    const priceList = await priceListWithOctoberAndNovember();
    const lookup = await priceList.versionValidAt('site-1', moment('2026-09-20T12:00:00.000Z'));
    expect(lookup).toEqual({ found: false, reason: 'no price known' });
  });

  it('says no price is known for a site that has no versions', async () => {
    const priceList = await priceListWithOctoberAndNovember();
    const lookup = await priceList.versionValidAt('site-2', moment('2026-10-15T12:00:00.000Z'));
    expect(lookup).toEqual({ found: false, reason: 'no price known' });
  });

  it('says no price is known when the moment is not a valid date', async () => {
    const priceList = await priceListWithOctoberAndNovember();
    const lookup = await priceList.versionValidAt('site-1', new Date('not a date'));
    expect(lookup).toEqual({ found: false, reason: 'no price known' });
  });

  it('keeps the versions of different sites apart', async () => {
    const priceList = priceListApproving('approval-a', 'approval-b');
    await priceList.applyApprovedVersion(priceVersion({ versionId: 'site-1-version', siteId: 'site-1' }), 'approval-a');
    await priceList.applyApprovedVersion(priceVersion({ versionId: 'site-2-version', siteId: 'site-2', firstHourFee: 20 }), 'approval-b');
    expectVersion(await priceList.versionValidAt('site-1', moment('2026-10-15T00:00:00.000Z')), 'site-1-version');
    expectVersion(await priceList.versionValidAt('site-2', moment('2026-10-15T00:00:00.000Z')), 'site-2-version');
  });

  it('returns the right version even when versions were added out of date order', async () => {
    const priceList = priceListApproving('approval-october', 'approval-november');
    await priceList.applyApprovedVersion(novemberVersion, 'approval-november');
    await priceList.applyApprovedVersion(octoberVersion, 'approval-october');
    expectVersion(await priceList.versionValidAt('site-1', moment('2026-10-15T00:00:00.000Z')), 'october');
    expectVersion(await priceList.versionValidAt('site-1', moment('2026-11-15T00:00:00.000Z')), 'november');
  });

  it('returns the numbers the committee approved, unchanged', async () => {
    const priceList = await priceListWithOctoberAndNovember();
    const lookup = await priceList.versionValidAt('site-1', moment('2026-11-15T00:00:00.000Z'));
    expect(lookup).toEqual({ found: true, version: novemberVersion });
  });
});

describe('B3 accepting new versions only from the approvals area', () => {
  it('accepts a version whose approval request is approved', async () => {
    const priceList = priceListApproving('approval-october');
    const outcome = await priceList.applyApprovedVersion(octoberVersion, 'approval-october');
    expect(outcome).toEqual({ applied: true });
  });

  it('refuses a version written directly, with an approval request that is not approved', async () => {
    const priceList = priceListApproving('approval-october');
    const outcome = await priceList.applyApprovedVersion(novemberVersion, 'made-up-request');
    expect(outcome).toEqual({ applied: false, reason: 'approval request not approved' });
  });

  it('does not keep a refused version: a later lookup still finds no price', async () => {
    const priceList = priceListApproving();
    await priceList.applyApprovedVersion(octoberVersion, 'made-up-request');
    const lookup = await priceList.versionValidAt('site-1', moment('2026-10-15T12:00:00.000Z'));
    expect(lookup).toEqual({ found: false, reason: 'no price known' });
  });

  it('refuses a version with an empty approval request id', async () => {
    const priceList = priceListApproving('');
    const outcome = await priceList.applyApprovedVersion(octoberVersion, '');
    expect(outcome).toEqual({ applied: false, reason: 'approval request not approved' });
  });

  it('waits for an approvals check that answers later', async () => {
    const priceList = createPriceList({
      isApproved: async (approvalRequestId) => {
        await Promise.resolve();
        return approvalRequestId === 'approval-october';
      },
    });
    expect(await priceList.applyApprovedVersion(octoberVersion, 'approval-october')).toEqual({ applied: true });
    expect(await priceList.applyApprovedVersion(novemberVersion, 'approval-other')).toEqual({
      applied: false,
      reason: 'approval request not approved',
    });
  });

  it('offers no way to add a version other than applyApprovedVersion', () => {
    const priceList = priceListApproving();
    expect(Object.keys(priceList).sort()).toEqual(['applyApprovedVersion', 'versionValidAt']);
  });

  it('refuses a second version that starts at the same moment as an existing one for the same site', async () => {
    const priceList = priceListApproving('approval-one', 'approval-two');
    await priceList.applyApprovedVersion(octoberVersion, 'approval-one');
    const outcome = await priceList.applyApprovedVersion(priceVersion({ versionId: 'duplicate-start' }), 'approval-two');
    expect(outcome).toEqual({ applied: false, reason: 'a version already starts at that moment' });
    expectVersion(await priceList.versionValidAt('site-1', moment('2026-10-15T00:00:00.000Z')), 'october');
  });

  it('keeps only one version when two approved versions with the same start arrive at the same time', async () => {
    const priceList = createPriceList({
      isApproved: async () => {
        await Promise.resolve();
        return true;
      },
    });
    const outcomes = await Promise.all([
      priceList.applyApprovedVersion(priceVersion({ versionId: 'first' }), 'approval-one'),
      priceList.applyApprovedVersion(priceVersion({ versionId: 'second' }), 'approval-two'),
    ]);
    expect(outcomes.filter((outcome) => outcome.applied)).toHaveLength(1);
  });

  describe('refusing a version whose numbers or start date make no sense', () => {
    const invalidVersions: ReadonlyArray<readonly [string, Partial<PriceVersion>]> = [
      ['a start date that is not a date', { validFrom: 'next week' }],
      ['a negative first-hour fee', { firstHourFee: -1 }],
      ['a negative later-hour fee', { eachLaterHourFee: -5 }],
      ['a negative daily cap', { dailyCap: -50 }],
      ['a fee that is not a whole number of pounds', { firstHourFee: 10.5 }],
      ['a fee that is not a number', { dailyCap: Number.NaN }],
    ];

    it.each(invalidVersions)('refuses %s', async (_description, overrides) => {
      const priceList = priceListApproving('approval-one');
      const outcome = await priceList.applyApprovedVersion(priceVersion(overrides), 'approval-one');
      expect(outcome).toEqual({ applied: false, reason: 'invalid price version' });
    });
  });
});

describe('B3 report', () => {
  it('reports how long a lookup takes with 1,000 versions at one site', async () => {
    const versionCount = 1000;
    const priceList = createPriceList({ isApproved: () => true });
    const firstStart = Date.UTC(2020, 0, 1);
    const oneDay = 24 * 3600 * 1000;
    for (let day = 0; day < versionCount; day += 1) {
      const outcome = await priceList.applyApprovedVersion(
        priceVersion({ versionId: `version-${day}`, validFrom: new Date(firstStart + day * oneDay).toISOString() }),
        `approval-${day}`,
      );
      expect(outcome.applied).toBe(true);
    }

    const lookups = 20_000;
    const started = performance.now();
    for (let count = 0; count < lookups; count += 1) {
      const lookupMoment = new Date(firstStart + (count % versionCount) * oneDay + 12 * 3600 * 1000);
      const lookup = await priceList.versionValidAt('site-1', lookupMoment);
      if (!lookup.found || lookup.version.versionId !== `version-${count % versionCount}`) {
        throw new Error(`wrong version found for lookup ${count}`);
      }
    }
    const microsecondsPerLookup = ((performance.now() - started) * 1000) / lookups;
    console.log(`B3 report: lookup time ${microsecondsPerLookup.toFixed(2)} microseconds on average, with ${versionCount} versions at one site`);
  });
});
