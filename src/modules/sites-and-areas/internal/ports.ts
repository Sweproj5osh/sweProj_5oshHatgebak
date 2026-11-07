import type { DistrictId, PersonId, SiteId, ZoneId } from '../../../shared/identifiers';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { GeoPoint, OpeningPeriod } from '../public';
import type { District, Site, Zone } from './domain/places';
import type { SpecialEvent } from './domain/site-calendar';

/**
 * Storage ports owned by this module. Every method takes the tables it works on (ADR-13): the committed tables for a
 * read outside a request, the request's unit of work for a write. The adapters in `adapters/` work over any
 * TableAccess, over the tables of `db/migrations/0002_identity_and_registry.sql`.
 */

/** The `sites_and_areas.districts`, `zones` and `sites` tables. */
export interface PlacesStore {
  addDistrict(tables: TableAccess, district: District): Promise<void>;
  district(tables: TableAccess, districtId: DistrictId): Promise<District | undefined>;
  relabelDistrict(tables: TableAccess, districtId: DistrictId, label: string): Promise<void>;
  addZone(tables: TableAccess, zone: Zone): Promise<void>;
  zone(tables: TableAccess, zoneId: ZoneId): Promise<Zone | undefined>;
  relabelZone(tables: TableAccess, zoneId: ZoneId, label: string): Promise<void>;
  addSite(tables: TableAccess, site: Site): Promise<void>;
  site(tables: TableAccess, siteId: SiteId): Promise<Site | undefined>;
  replaceOutline(tables: TableAccess, siteId: SiteId, outline: readonly GeoPoint[]): Promise<void>;
  allSites(tables: TableAccess): Promise<readonly Site[]>;
}

/** One row of the `sites_and_areas.capacity_changes` table: insert-only, the latest row is the current capacity. */
export interface CapacityChangeRow {
  readonly siteId: SiteId;
  readonly capacity: number;
  readonly reason: string;
  readonly changedBy: PersonId;
  /** Set from the server clock (Rule I). */
  readonly changedAt: string;
}

export interface CapacityStore {
  append(tables: TableAccess, change: CapacityChangeRow): Promise<void>;
  /** Oldest first. */
  historyOf(tables: TableAccess, siteId: SiteId): Promise<readonly CapacityChangeRow[]>;
}

/** A declared closure or free period, with who declared it and when by the server clock. */
export interface SpecialEventRow extends SpecialEvent {
  readonly siteId: SiteId;
  readonly declaredBy: PersonId;
  readonly declaredAt: string;
}

/**
 * The `sites_and_areas.opening_hours` and `special_events` tables. A site with no hours rows is never open; an
 * explicit 00:00–24:00 row on every weekday is how the committee says "always open" (P23 #12).
 */
export interface SiteCalendarStore {
  weeklyHours(tables: TableAccess, siteId: SiteId): Promise<readonly OpeningPeriod[]>;
  replaceWeeklyHours(tables: TableAccess, siteId: SiteId, periods: readonly OpeningPeriod[]): Promise<void>;
  addEvent(tables: TableAccess, event: SpecialEventRow): Promise<void>;
  eventsOf(tables: TableAccess, siteId: SiteId): Promise<readonly SpecialEventRow[]>;
}
