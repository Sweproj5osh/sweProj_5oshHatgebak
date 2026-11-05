export type FreeSpaceBand = 'free' | 'few' | 'full' | 'unknown';

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface SiteMapEntry {
  readonly siteId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly firstHourFee: number;
  readonly capacity: number;
  readonly openTicketCount: number;
}

export interface NearbySiteResult {
  readonly siteId: string;
  readonly distanceMeters: number;
  readonly firstHourFee: number;
  readonly band: FreeSpaceBand;
}

export interface DriverMapState {
  readonly sites: Map<string, SiteMapEntry>;
  readonly refreshIntervalMs: number;
  lastRefreshedAtMs: number | undefined;
}

export function createDriverMapState(entries: readonly SiteMapEntry[] = []): DriverMapState {
  return {
    sites: new Map(entries.map((entry) => [entry.siteId, entry])),
    refreshIntervalMs: 15_000,
    lastRefreshedAtMs: undefined,
  };
}

export function addSiteToMap(state: DriverMapState, entry: SiteMapEntry): void {
  state.sites.set(entry.siteId, entry);
}

export function updateSiteTicketCount(state: DriverMapState, siteId: string, openTicketCount: number): void {
  const existing = state.sites.get(siteId);
  if (!existing) {
    return;
  }

  state.sites.set(siteId, {
    ...existing,
    openTicketCount,
  });
}

export function computeFreeSpaceBand(capacity: number, openTicketCount: number): FreeSpaceBand {
  if (capacity <= 0) {
    return 'full';
  }
  if (openTicketCount >= capacity) {
    return 'full';
  }
  if (openTicketCount >= Math.ceil(capacity * 0.75)) {
    return 'few';
  }
  return 'free';
}

export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const latitudeDelta = to.latitude - from.latitude;
  const longitudeDelta = to.longitude - from.longitude;
  return Math.sqrt(latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta) * 111_000;
}

export function nearbySites(state: DriverMapState, from: GeoPoint, radiusMeters: number): NearbySiteResult[] {
  return [...state.sites.values()]
    .filter((site) => distanceMeters(from, { latitude: site.latitude, longitude: site.longitude }) <= radiusMeters)
    .map((site) => ({
      siteId: site.siteId,
      distanceMeters: distanceMeters(from, { latitude: site.latitude, longitude: site.longitude }),
      firstHourFee: site.firstHourFee,
      band: computeFreeSpaceBand(site.capacity, site.openTicketCount),
    }))
    .sort((left, right) => {
      if (left.distanceMeters !== right.distanceMeters) {
        return left.distanceMeters - right.distanceMeters;
      }
      return bandOrder(left.band) - bandOrder(right.band);
    });
}

export function getRefreshIntervalMs(): number {
  return 15_000;
}

export function isRefreshDue(state: DriverMapState, nowMs: number): boolean {
  if (state.lastRefreshedAtMs === undefined) {
    return true;
  }
  return nowMs - state.lastRefreshedAtMs >= state.refreshIntervalMs;
}

function bandOrder(band: FreeSpaceBand): number {
  switch (band) {
    case 'free':
      return 0;
    case 'few':
      return 1;
    case 'full':
      return 2;
    default:
      return 3;
  }
}
