/**
 * Driver map API adapter: call the main system through the HTTP entry point and read Lino's `{ sites }` answer. The
 * band is passed through as the word the server chose; a word outside his set is a fault, never a guess.
 */
import { asRecord, nullableNumber, requiredBoolean, requiredList, requiredNumber, requiredRecord, requiredString, requiredWord, type ServerAnswer } from '../server-answer';
import { asTransportFailureIfServerFailed, ServerCall, ServerRefusedError, UNAUTHORIZED, type EntryPointHandle } from '../server-call';
import { DriverMapRefusedError, FREE_SPACE_BANDS, isDriverMapRefusal, type DriverMapApi, type GeoPoint, type NearbySite } from './driver-map-api';
import { DRIVER_MAP_NEARBY_PATH } from './driver-map-routes';

export interface HttpDriverMapApiOptions {
  readonly handle: EntryPointHandle;
  readonly token: () => string | undefined;
}

export class HttpDriverMapApi implements DriverMapApi {
  private readonly server: ServerCall;

  constructor(options: HttpDriverMapApiOptions) {
    this.server = new ServerCall({ handle: options.handle, token: options.token });
  }

  async nearbySites(from: GeoPoint, radiusMeters: number): Promise<readonly NearbySite[]> {
    const query = { latitude: String(from.latitude), longitude: String(from.longitude), radius: String(radiusMeters) };
    const answer = await this.server.read(DRIVER_MAP_NEARBY_PATH, query).catch(rethrowAsDriverMapRefusal);
    return requiredList(answer, 'sites').map((site) => readNearbySite(asRecord(site)));
  }
}

function readNearbySite(site: ServerAnswer): NearbySite {
  const centre = requiredRecord(site, 'centre');
  return {
    siteId: requiredString(site, 'siteId'),
    label: requiredString(site, 'label'),
    centre: { latitude: requiredNumber(centre, 'latitude'), longitude: requiredNumber(centre, 'longitude') },
    distanceMeters: requiredNumber(site, 'distanceMeters'),
    open: requiredBoolean(site, 'open'),
    firstHourFee: nullableNumber(site, 'firstHourFee'),
    band: requiredWord(site, 'band', FREE_SPACE_BANDS),
  };
}

function rethrowAsDriverMapRefusal(error: unknown): never {
  if (error instanceof ServerRefusedError) {
    if (isDriverMapRefusal(error.refusal)) {
      throw new DriverMapRefusedError(error.refusal);
    }
    if (error.status === UNAUTHORIZED) {
      throw new DriverMapRefusedError('not signed in');
    }
  }
  return asTransportFailureIfServerFailed(error);
}
