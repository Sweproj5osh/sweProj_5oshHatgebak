/**
 * The Driver App's view of the map (task D2). The free-space band is a word the server computes from the tickets and
 * the committee's cut-offs (P11, Rule G); the app displays the word and re-reads it every
 * FREE_SPACE_BAND_REFRESH_MILLISECONDS. Nothing here derives a band, a fee or a distance (Rule A).
 *
 * The shapes are Lino's `NearbySite`, `FreeSpaceBand` and `NearbyRefusal` from the sites-and-areas public interface.
 */
import type { SiteId } from '../../../shared/identifiers';

export type FreeSpaceBand = 'free' | 'few' | 'full' | 'unknown';

export const FREE_SPACE_BANDS: readonly FreeSpaceBand[] = ['free', 'few', 'full', 'unknown'];

/** How often the map re-reads the band the server returns (task D2; Q9 of the decisions). */
export const FREE_SPACE_BAND_REFRESH_MILLISECONDS = 15_000;

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/** One site on the driver's map. The fee is null and the band "unknown" when their source did not answer. */
export interface NearbySite {
  readonly siteId: SiteId;
  readonly label: string;
  readonly centre: GeoPoint;
  readonly distanceMeters: number;
  readonly open: boolean;
  readonly firstHourFee: number | null;
  readonly band: FreeSpaceBand;
}

export type DriverMapRefusal = 'invalid point' | 'invalid radius' | 'not signed in';

export const DRIVER_MAP_REFUSALS: readonly DriverMapRefusal[] = ['invalid point', 'invalid radius', 'not signed in'];

export function isDriverMapRefusal(candidate: unknown): candidate is DriverMapRefusal {
  return typeof candidate === 'string' && (DRIVER_MAP_REFUSALS as readonly string[]).includes(candidate);
}

/** The server answered and said no. Nothing changed. */
export class DriverMapRefusedError extends Error {
  readonly refusal: DriverMapRefusal;

  constructor(refusal: DriverMapRefusal) {
    super(refusal);
    this.name = 'DriverMapRefusedError';
    this.refusal = refusal;
  }
}

export interface DriverMapApi {
  nearbySites(from: GeoPoint, radiusMeters: number): Promise<readonly NearbySite[]>;
}
