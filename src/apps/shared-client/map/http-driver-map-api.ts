/**
 * Driver map API adapter: call the main system through the HTTP entry point and translate server answers into
 * app errors or data. The app holds no business rule; it displays what the server tells it.
 */
import { asRecord, requiredList, requiredNumber, requiredString, requiredWord, type ServerAnswer } from '../server-answer';
import { ServerCall, ServerRefusedError, UNAUTHORIZED, type EntryPointHandle } from '../server-call';
import {
  DriverMapRefusedError,
  FREE_SPACE_BANDS,
  isDriverMapRefusal,
  type DriverMapApi,
  type GeoPoint,
  type NearbySiteResult,
} from './driver-map-api';
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

  async nearbySites(from: GeoPoint, radiusMeters: number): Promise<readonly NearbySiteResult[]> {
    const answer = await this.server
      .read(DRIVER_MAP_NEARBY_PATH, { latitude: String(from.latitude), longitude: String(from.longitude), radiusMeters: String(radiusMeters) })
      .catch(rethrowAsDriverMapRefusal);
    return requiredList(answer, 'sites').map((entry) => readNearbySite(asRecord(entry)));
  }

  getRefreshIntervalMs(): number {
    return 15_000;
  }
}

function readNearbySite(record: ServerAnswer): NearbySiteResult {
  return {
    siteId: requiredString(record, 'siteId'),
    distanceMeters: requiredNumber(record, 'distanceMeters'),
    firstHourFee: requiredNumber(record, 'firstHourFee'),
    band: requiredWord(record, 'band', FREE_SPACE_BANDS),
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
  throw error;
}
