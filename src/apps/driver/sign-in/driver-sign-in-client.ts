/**
 * Driver App sign-in and cars client (task D1).
 * Collects phone then code (two taps), then can save a plate. Auth decisions stay on the server (Rule A).
 */
import type { PersonId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';
import {
  DriverAuthTransportError,
  type DriverAuthApi,
  type SignInSuccess,
} from './driver-auth-api';

export type DriverSignInClientSuccess<T> = { readonly ok: true; readonly value: T };
export type DriverSignInClientFailure =
  | { readonly ok: false; readonly error: 'connection lost'; readonly requestId: RequestId }
  | { readonly ok: false; readonly error: 'wrong code' | 'locked out' | 'unknown phone' | 'not signed in' };

export type DriverSignInClientResult<T> = DriverSignInClientSuccess<T> | DriverSignInClientFailure;

export interface DriverSignInClientOptions {
  readonly api: DriverAuthApi;
  readonly createRequestId: () => RequestId;
}

export class DriverSignInClient {
  private readonly api: DriverAuthApi;
  private readonly createRequestId: () => RequestId;
  private taps = 0;
  private phone: string | undefined;
  private session: SignInSuccess | undefined;
  private pendingCodeRequestId: RequestId | undefined;
  private pendingSignInRequestId: RequestId | undefined;

  constructor(options: DriverSignInClientOptions) {
    this.api = options.api;
    this.createRequestId = options.createRequestId;
  }

  /** How many taps the driver has made on the sign-in flow so far (D1 report). */
  tapsToSignIn(): number {
    return this.taps;
  }

  driverId(): PersonId | undefined {
    return this.session?.driverId;
  }

  token(): string | undefined {
    return this.session?.token;
  }

  isSignedIn(): boolean {
    return this.session !== undefined;
  }

  /**
   * First tap: submit the phone number so the server can send a one-time code.
   */
  async submitPhone(phone: string): Promise<DriverSignInClientResult<void>> {
    this.taps += 1;
    this.phone = phone;
    if (this.pendingCodeRequestId === undefined) {
      this.pendingCodeRequestId = this.createRequestId();
    }

    try {
      await this.api.requestCode(phone, this.pendingCodeRequestId);
      this.pendingCodeRequestId = undefined;
      return { ok: true, value: undefined };
    } catch (error) {
      if (error instanceof DriverAuthTransportError) {
        return { ok: false, error: 'connection lost', requestId: this.pendingCodeRequestId };
      }
      this.pendingCodeRequestId = undefined;
      throw error;
    }
  }

  /**
   * Second tap: submit the one-time code. On success the driver is signed in.
   */
  async submitCode(code: string): Promise<DriverSignInClientResult<SignInSuccess>> {
    if (this.phone === undefined) {
      throw new Error('submit the phone number before the code');
    }

    this.taps += 1;
    if (this.pendingSignInRequestId === undefined) {
      this.pendingSignInRequestId = this.createRequestId();
    }

    try {
      const session = await this.api.signIn(this.phone, code, this.pendingSignInRequestId);
      this.session = session;
      this.pendingSignInRequestId = undefined;
      return { ok: true, value: session };
    } catch (error) {
      if (error instanceof DriverAuthTransportError) {
        return { ok: false, error: 'connection lost', requestId: this.pendingSignInRequestId };
      }
      this.pendingSignInRequestId = undefined;
      if (error instanceof Error && isSignInRefusal(error.message)) {
        return { ok: false, error: error.message };
      }
      throw error;
    }
  }

  /** Save a plate for the signed-in driver; the server returns the driver's cars. */
  async addCar(plate: string): Promise<DriverSignInClientResult<readonly string[]>> {
    if (this.session === undefined) {
      return { ok: false, error: 'not signed in' };
    }

    const requestId = this.createRequestId();
    try {
      const cars = await this.api.saveCar(plate, requestId);
      return { ok: true, value: cars };
    } catch (error) {
      if (error instanceof DriverAuthTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      throw error;
    }
  }

  async listCars(): Promise<DriverSignInClientResult<readonly string[]>> {
    if (this.session === undefined) {
      return { ok: false, error: 'not signed in' };
    }

    try {
      return { ok: true, value: await this.api.listCars() };
    } catch (error) {
      if (error instanceof DriverAuthTransportError) {
        return { ok: false, error: 'connection lost', requestId: this.createRequestId() };
      }
      throw error;
    }
  }
}

function isSignInRefusal(message: string): message is 'wrong code' | 'locked out' | 'unknown phone' {
  return message === 'wrong code' || message === 'locked out' || message === 'unknown phone';
}
