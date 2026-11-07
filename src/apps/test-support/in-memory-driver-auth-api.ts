/**
 * In-memory stand-in for driver sign-in and cars, for client tests that need no server.
 * Tests and local prototypes only; it is not the accounts module and copies only the answers the client tests need.
 */
import type { PersonId } from '../../shared/identifiers';
import type { RequestId } from '../../shared/request-id';
import type { TokenIssuer } from '../../shared/token-issuer';
import { DriverAuthRefusedError, type DriverAuthApi, type SignInSuccess } from '../shared-client/sign-in/driver-auth-api';

export interface InMemoryDriverAuthApiOptions {
  /** Mints the token a signed-in driver carries; tests pass the entry point's issuer or an opaque stand-in. */
  readonly tokens: TokenIssuer;
  /** Expected one-time codes keyed by phone. Missing phones get `driver-code-<phone>`. */
  readonly codes?: ReadonlyMap<string, string>;
}

export class InMemoryDriverAuthApi implements DriverAuthApi {
  private readonly tokens: TokenIssuer;
  private readonly codes: Map<string, string>;
  private readonly requestCodeResponses = new Map<RequestId, true>();
  private readonly signInResponses = new Map<RequestId, SignInSuccess>();
  private readonly saveCarResponses = new Map<RequestId, readonly string[]>();
  private readonly carsByDriver = new Map<PersonId, string[]>();
  private readonly driverByPhone = new Map<string, PersonId>();
  private currentDriverId: PersonId | undefined;

  constructor(options: InMemoryDriverAuthApiOptions) {
    this.tokens = options.tokens;
    this.codes = new Map(options.codes ?? []);
  }

  async requestCode(phone: string, requestId: RequestId): Promise<void> {
    if (this.requestCodeResponses.has(requestId)) {
      return;
    }
    this.requestCodeResponses.set(requestId, true);
    if (!this.codes.has(phone)) {
      this.codes.set(phone, `driver-code-${phone}`);
    }
  }

  async signIn(phone: string, code: string, requestId: RequestId): Promise<SignInSuccess> {
    const known = this.signInResponses.get(requestId);
    if (known !== undefined) {
      this.currentDriverId = this.driverByPhone.get(phone);
      return known;
    }

    const expected = this.codes.get(phone) ?? `driver-code-${phone}`;
    if (code !== expected) {
      throw new DriverAuthRefusedError('wrong code');
    }

    let driverId = this.driverByPhone.get(phone);
    if (driverId === undefined) {
      driverId = `driver-${phone}`;
      this.driverByPhone.set(phone, driverId);
    }

    const success: SignInSuccess = { token: this.tokens.issue({ personId: driverId, role: 'driver' }) };
    this.signInResponses.set(requestId, success);
    this.currentDriverId = driverId;
    return success;
  }

  async saveCar(plate: string, requestId: RequestId): Promise<readonly string[]> {
    const known = this.saveCarResponses.get(requestId);
    if (known !== undefined) {
      return known;
    }

    const driverId = this.currentDriverId;
    if (driverId === undefined) {
      throw new DriverAuthRefusedError('not signed in');
    }

    const existing = this.carsByDriver.get(driverId) ?? [];
    const cars = existing.includes(plate) ? [...existing] : [...existing, plate];
    this.carsByDriver.set(driverId, cars);
    this.saveCarResponses.set(requestId, cars);
    return cars;
  }

  async listCars(): Promise<readonly string[]> {
    const driverId = this.currentDriverId;
    if (driverId === undefined) {
      throw new DriverAuthRefusedError('not signed in');
    }
    return [...(this.carsByDriver.get(driverId) ?? [])];
  }
}
