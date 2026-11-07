import type { DistrictId, SiteId, ZoneId } from '../../../../shared/identifiers';
import type { Row, TableAccess } from '../../../../shared/unit-of-work';
import type { GeoPoint, OpeningPeriod } from '../../public';
import type { District, Site, Zone } from '../domain/places';
import type { CapacityChangeRow, CapacityStore, PlacesStore, SiteCalendarStore, SpecialEventRow } from '../ports';

/**
 * This module's stores over the shared TableAccess (ADR-13): the same adapters serve the in-memory database of every
 * test and a PostgreSQL unit of work later. Table names follow `db/migrations/0002_identity_and_registry.sql`.
 */
export const DISTRICTS_TABLE = 'sites_and_areas.districts';
export const ZONES_TABLE = 'sites_and_areas.zones';
export const SITES_TABLE = 'sites_and_areas.sites';
export const CAPACITY_CHANGES_TABLE = 'sites_and_areas.capacity_changes';
export const OPENING_HOURS_TABLE = 'sites_and_areas.opening_hours';
export const SPECIAL_EVENTS_TABLE = 'sites_and_areas.special_events';

export class TablePlacesStore implements PlacesStore {
  async addDistrict(tables: TableAccess, district: District): Promise<void> {
    await tables.insert(DISTRICTS_TABLE, district.districtId, district);
  }

  district(tables: TableAccess, districtId: DistrictId): Promise<District | undefined> {
    return tables.read<District>(DISTRICTS_TABLE, districtId);
  }

  async relabelDistrict(tables: TableAccess, districtId: DistrictId, label: string): Promise<void> {
    await tables.replace(DISTRICTS_TABLE, districtId, { ...(await existing(tables, DISTRICTS_TABLE, districtId, 'district')), label });
  }

  async addZone(tables: TableAccess, zone: Zone): Promise<void> {
    await tables.insert(ZONES_TABLE, zone.zoneId, zone);
  }

  zone(tables: TableAccess, zoneId: ZoneId): Promise<Zone | undefined> {
    return tables.read<Zone>(ZONES_TABLE, zoneId);
  }

  async relabelZone(tables: TableAccess, zoneId: ZoneId, label: string): Promise<void> {
    await tables.replace(ZONES_TABLE, zoneId, { ...(await existing(tables, ZONES_TABLE, zoneId, 'zone')), label });
  }

  async addSite(tables: TableAccess, site: Site): Promise<void> {
    await tables.insert(SITES_TABLE, site.siteId, site);
  }

  site(tables: TableAccess, siteId: SiteId): Promise<Site | undefined> {
    return tables.read<Site>(SITES_TABLE, siteId);
  }

  async replaceOutline(tables: TableAccess, siteId: SiteId, outline: readonly GeoPoint[]): Promise<void> {
    await tables.replace(SITES_TABLE, siteId, { ...(await existing(tables, SITES_TABLE, siteId, 'site')), outline });
  }

  allSites(tables: TableAccess): Promise<readonly Site[]> {
    return tables.list<Site>(SITES_TABLE);
  }
}

/** The insert order, kept in the row so the history reads oldest first whatever the storage returns. */
interface StoredCapacityChange extends CapacityChangeRow {
  readonly sequence: number;
}

export class TableCapacityStore implements CapacityStore {
  async append(tables: TableAccess, change: CapacityChangeRow): Promise<void> {
    const sequence = (await tables.list<StoredCapacityChange>(CAPACITY_CHANGES_TABLE)).length + 1;
    await tables.insert(CAPACITY_CHANGES_TABLE, `${change.siteId}/${sequence}`, { ...change, sequence });
  }

  async historyOf(tables: TableAccess, siteId: SiteId): Promise<readonly CapacityChangeRow[]> {
    return (await tables.list<StoredCapacityChange>(CAPACITY_CHANGES_TABLE))
      .filter((change) => change.siteId === siteId)
      .sort((first, second) => first.sequence - second.sequence)
      .map(({ sequence: _order, ...change }) => change);
  }
}

/** The weekly hours of one site as one row: the PostgreSQL adapter spreads them over one row per period. */
interface StoredWeeklyHours {
  readonly siteId: SiteId;
  readonly periods: readonly OpeningPeriod[];
}

export class TableSiteCalendarStore implements SiteCalendarStore {
  async weeklyHours(tables: TableAccess, siteId: SiteId): Promise<readonly OpeningPeriod[]> {
    return (await tables.read<StoredWeeklyHours>(OPENING_HOURS_TABLE, siteId))?.periods ?? [];
  }

  async replaceWeeklyHours(tables: TableAccess, siteId: SiteId, periods: readonly OpeningPeriod[]): Promise<void> {
    const row: StoredWeeklyHours = { siteId, periods };
    if ((await tables.read(OPENING_HOURS_TABLE, siteId)) === undefined) {
      await tables.insert(OPENING_HOURS_TABLE, siteId, row);
    } else {
      await tables.replace(OPENING_HOURS_TABLE, siteId, row);
    }
  }

  async addEvent(tables: TableAccess, event: SpecialEventRow): Promise<void> {
    await tables.insert(SPECIAL_EVENTS_TABLE, event.eventId, event);
  }

  async eventsOf(tables: TableAccess, siteId: SiteId): Promise<readonly SpecialEventRow[]> {
    return (await tables.list<SpecialEventRow>(SPECIAL_EVENTS_TABLE)).filter((event) => event.siteId === siteId);
  }
}

async function existing<Stored extends Row>(tables: TableAccess, table: string, id: string, kind: string): Promise<Stored> {
  const row = await tables.read<Stored>(table, id);
  if (row === undefined) {
    throw new Error(`No ${kind} with the id ${id}`);
  }
  return row;
}
