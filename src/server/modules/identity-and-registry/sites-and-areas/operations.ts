import type { Clock } from '../../../shared/clock';
import type { Operation } from '../../../shared/operation-contract';
import type { SiteRegistry } from './index';
import { createDistrict, relabelDistrict } from './districts-controller';
import { changeCapacity, createSite, declareSpecialEvent, readCapacityHistory, readNearbySites, readSiteDetails, readSiteStatus, replaceSiteOutline, setWeeklyHours } from './sites-controller';
import { createZone, relabelZone } from './zones-controller';

export interface SitesOperationsDependencies {
  readonly siteRegistry: SiteRegistry;
  readonly clock: Clock;
}

/**
 * The requests this module answers, for the composition root to register (P4). The entry point checks the token, the
 * role, the request id and the body before a handler runs, and writes the one audit entry after it succeeds; the
 * handler adds the district so that members of that district can read the entry (ADR-10). An outline travels as a
 * list of points and a closure as two calendar times (P6); nothing time-like comes from a phone (Rule I).
 */
export function sitesOperations({ siteRegistry, clock }: SitesOperationsDependencies): readonly Operation[] {
  return [
    createDistrict(siteRegistry),
    relabelDistrict(siteRegistry),
    createZone(siteRegistry),
    relabelZone(siteRegistry),
    createSite(siteRegistry),
    replaceSiteOutline(siteRegistry),
    changeCapacity(siteRegistry),
    setWeeklyHours(siteRegistry),
    declareSpecialEvent(siteRegistry),
    readSiteDetails(siteRegistry),
    readSiteStatus(siteRegistry, clock),
    readNearbySites(siteRegistry),
    readCapacityHistory(siteRegistry),
  ];
}
