/**
 * Sites & Areas — owner: Teammate A (Area 2). Must-stay-on set.
 * Districts, zones, sites, capacity with history, hours, special events, signed entry and exit codes. Needs AuditTrail.
 */
import type { DistrictId, PersonId, SiteId, ZoneId } from '../../shared/identifiers';
import type { Result } from '../../shared/result';

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

export type SiteCodeRefusal = 'forged' | 'wrong site';

export interface SiteRegistry {
  createDistrict(actor: PersonId, name: string): Promise<DistrictId>;
  createZone(actor: PersonId, districtId: DistrictId, name: string): Promise<ZoneId>;
  createSite(actor: PersonId, zoneId: ZoneId, outline: readonly GeoPoint[], capacity: number): Promise<SiteId>;
  changeCapacity(actor: PersonId, siteId: SiteId, capacity: number, reason: string): Promise<void>;
  capacityHistory(siteId: SiteId): Promise<readonly CapacityChange[]>;
  isOpenAt(siteId: SiteId, moment: Date): Promise<boolean>;
  nearbySites(from: GeoPoint, radiusMeters: number): Promise<readonly NearbySite[]>;
  issueEntryAndExitCodes(siteId: SiteId): Promise<{ entryCode: string; exitCode: string }>;
  verifyEntryCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeRefusal>>;
  verifyExitCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeRefusal>>;
}
