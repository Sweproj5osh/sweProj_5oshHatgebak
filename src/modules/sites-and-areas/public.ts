/**
 * Sites & Areas — owner: Teammate A (Area 2). Must-stay-on set.
 * Districts, zones, sites, capacity with history, hours, special events, signed entry and exit codes. Needs AuditTrail.
 */
import type { DistrictId, PersonId, SiteId, ZoneId } from '../../shared/identifiers';
import type { Result } from '../../shared/result';
import { SiteCodeSigner } from './internal/domain/site-code-signer';
import { SiteCodesService } from './internal/site-codes-service';

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export type FreeSpaceBand = 'free' | 'few' | 'full' | 'unknown';

export interface NearbySite {
  readonly siteId: SiteId;
  readonly distanceMeters: number;
  readonly firstHourFee: number;
  readonly band: FreeSpaceBand;
}

export interface CapacityChange {
  readonly capacity: number;
  readonly reason: string;
  readonly changedAt: string;
}

export type SiteCodeKind = 'entry' | 'exit';

/**
 * "forged": not signed by this system, or altered. "wrong site": genuine, but printed at another site.
 * "wrong kind": genuine, but an exit code presented at the entry or the other way round.
 */
export type SiteCodeRefusal = 'forged' | 'wrong site' | 'wrong kind';

/** The signed codes printed at each site (task A7). Ticketing verifies every scan through these two checks. */
export interface SiteCodes {
  issueEntryAndExitCodes(siteId: SiteId): Promise<{ entryCode: string; exitCode: string }>;
  verifyEntryCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeRefusal>>;
  verifyExitCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeRefusal>>;
}

export interface SiteRegistry extends SiteCodes {
  createDistrict(actor: PersonId, name: string): Promise<DistrictId>;
  createZone(actor: PersonId, districtId: DistrictId, name: string): Promise<ZoneId>;
  createSite(actor: PersonId, zoneId: ZoneId, outline: readonly GeoPoint[], capacity: number): Promise<SiteId>;
  changeCapacity(actor: PersonId, siteId: SiteId, capacity: number, reason: string): Promise<void>;
  capacityHistory(siteId: SiteId): Promise<readonly CapacityChange[]>;
  isOpenAt(siteId: SiteId, moment: Date): Promise<boolean>;
  nearbySites(from: GeoPoint, radiusMeters: number): Promise<readonly NearbySite[]>;
}

/** The environment variable holding the secret that signs site codes (a name only; the value never enters the code). */
export const SITE_CODE_SECRET_VARIABLE = 'SITE_CODE_SECRET';

export function createSiteCodes(secret: string): SiteCodes {
  return new SiteCodesService(new SiteCodeSigner(secret));
}
