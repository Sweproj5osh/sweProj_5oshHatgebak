/**
 * In-memory stand-in for the map data layer, for client tests that need no server (P14). It plays the server: it
 * derives distance, order and the band word from the seeded counts, which is exactly what the app must never do; that
 * is why this file lives in test-support and not in the library.
 */
import { ServerTransportError } from '../shared-client/server-call';
import type { DriverMapApi, FreeSpaceBand, GeoPoint, NearbySite } from '../shared-client/map/driver-map-api';

/** What the stand-in server knows about a site; the app never sees capacity or counts (Rule G: tickets are the truth). */
export interface SiteMapEntry {
  readonly siteId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly firstHourFee: number;
  readonly capacity: number;
  readonly openTicketCount: number;
}

/** Engineering defaults of P11, as Lino listed them: "full" at 0 spaces, "few" at 2 or fewer or a fifth of capacity. */
const FEW_SPACES_AT_MOST = 2;
const FEW_SPACES_SHARE_OF_CAPACITY = 1 / 5;
const METRES_PER_DEGREE = 111_000;

export class InMemoryDriverMapApi implements DriverMapApi {
  private readonly sites: Map<string, SiteMapEntry>;
  private transportDropsRemaining = 0;

  constructor(entries: readonly SiteMapEntry[] = []) {
    this.sites = new Map(entries.map((entry) => [entry.siteId, entry]));
  }

  /** Drop the next successful answer after the server has applied its result. */
  dropNextAnswers(count: number): void {
    this.transportDropsRemaining = count;
  }

  addSite(entry: SiteMapEntry): void {
    this.sites.set(entry.siteId, entry);
  }

  updateSiteTicketCount(siteId: string, openTicketCount: number): void {
    const existing = this.sites.get(siteId);
    if (existing !== undefined) {
      this.sites.set(siteId, { ...existing, openTicketCount });
    }
  }

  async nearbySites(from: GeoPoint, radiusMeters: number): Promise<readonly NearbySite[]> {
    const nearby = [...this.sites.values()]
      .map((site) => toNearbySite(site, from))
      .filter((site) => site.distanceMeters <= radiusMeters)
      .sort((left, right) => left.distanceMeters - right.distanceMeters);

    if (this.transportDropsRemaining > 0) {
      this.transportDropsRemaining -= 1;
      throw new ServerTransportError();
    }
    return nearby;
  }
}

function toNearbySite(site: SiteMapEntry, from: GeoPoint): NearbySite {
  const centre = { latitude: site.latitude, longitude: site.longitude };
  return {
    siteId: site.siteId,
    label: site.siteId,
    centre,
    distanceMeters: distanceMeters(from, centre),
    open: true,
    firstHourFee: site.firstHourFee,
    band: bandOf(site.capacity, site.openTicketCount),
  };
}

function bandOf(capacity: number, openTicketCount: number): FreeSpaceBand {
  const freeSpaces = capacity - openTicketCount;
  if (freeSpaces <= 0) {
    return 'full';
  }
  if (freeSpaces <= FEW_SPACES_AT_MOST || freeSpaces <= capacity * FEW_SPACES_SHARE_OF_CAPACITY) {
    return 'few';
  }
  return 'free';
}

function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const latitudeDelta = to.latitude - from.latitude;
  const longitudeDelta = to.longitude - from.longitude;
  return Math.sqrt(latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta) * METRES_PER_DEGREE;
}
