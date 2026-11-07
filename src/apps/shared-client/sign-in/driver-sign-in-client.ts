/**
 * Driver App sign-in and cars client (task D1).
 * Collects the phone number, then the code (two taps), then can save a plate. Every decision stays on the server
 * (Rule A): the client shows the server's refusal and never judges a code or a plate itself.
 *
 * Every write keeps its request id until the answer arrives (Rule H, `RequestIdKeeper`), so after a lost connection
 * the retry carries the same id and the server answers once.
 */
import type { RequestId } from '../../../shared/request-id';
import { RequestIdKeeper } from '../request-id';
import { ServerTransportError } from '../server-call';
import { DriverAuthRefusedError, type DriverAuthApi, type DriverAuthRefusal, type SignInSuccess } from './driver-auth-api';

export type DriverSignInClientSuccess<T> = { readonly ok: true; readonly value: T };
export type DriverSignInClientFailure =
  /** A write carries the id the retry will reuse; a read has none. */
  | { readonly ok: false; readonly error: 'connection lost'; readonly requestId?: RequestId }
  | { readonly ok: false; readonly error: DriverAuthRefusal };

export type DriverSignInClientResult<T> = DriverSignInClientSuccess<T> | DriverSignInClientFailure;

export interface DriverSignInClientOptions {
  readonly api: DriverAuthApi;
  /** Only tests replace the generator. */
  readonly createRequestId?: () => RequestId;
}

export class DriverSignInClient {
  private readonly api: DriverAuthApi;
  private readonly codeRequests: RequestIdKeeper;
  private readonly signInRequests: RequestIdKeeper;
  private readonly carRequests: RequestIdKeeper;
  private taps = 0;
  private phone: string | undefined;
  private session: SignInSuccess | undefined;

  constructor(options: DriverSignInClientOptions) {
    this.api = options.api;
    this.codeRequests = new RequestIdKeeper(options.createRequestId);
    this.signInRequests = new RequestIdKeeper(options.createRequestId);
    this.carRequests = new RequestIdKeeper(options.createRequestId);
  }

  /** How many taps the driver has made on the sign-in flow so far (D1 report: 2 on the way in with the right code). */
  tapsToSignIn(): number {
    return this.taps;
  }

  token(): string | undefined {
    return this.session?.token;
  }

  isSignedIn(): boolean {
    return this.session !== undefined;
  }

  /** The request id kept for an unanswered sign-in code request, for tests and for the "try again" screen. */
  pendingCodeRequestId(): RequestId | undefined {
    return this.codeRequests.pendingId();
  }

  pendingSignInRequestId(): RequestId | undefined {
    return this.signInRequests.pendingId();
  }

  pendingCarRequestId(): RequestId | undefined {
    return this.carRequests.pendingId();
  }

  /** First tap: submit the phone number so the server can send a one-time code. */
  async submitPhone(phone: string): Promise<DriverSignInClientResult<void>> {
    this.taps += 1;
    this.phone = phone;
    const requestId = this.codeRequests.idFor(phone);

    try {
      await this.api.requestCode(phone, requestId);
      this.codeRequests.settle();
      return { ok: true, value: undefined };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      this.codeRequests.settle();
      return this.refusalOrRethrow(error);
    }
  }

  /** Second tap: submit the one-time code. On success the driver is signed in. */
  async submitCode(code: string): Promise<DriverSignInClientResult<SignInSuccess>> {
    const phone = this.phone;
    if (phone === undefined) {
      throw new Error('submit the phone number before the code');
    }

    this.taps += 1;
    const requestId = this.signInRequests.idFor(`${phone}\u0000${code}`);

    try {
      const session = await this.api.signIn(phone, code, requestId);
      this.session = session;
      this.signInRequests.settle();
      return { ok: true, value: session };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      this.signInRequests.settle();
      return this.refusalOrRethrow(error);
    }
  }

  /** Save a plate for the signed-in driver; the server returns the driver's plates as it stores them. */
  async addCar(plate: string): Promise<DriverSignInClientResult<readonly string[]>> {
    if (this.session === undefined) {
      return { ok: false, error: 'not signed in' };
    }

    const requestId = this.carRequests.idFor(plate);

    try {
      const cars = await this.api.saveCar(plate, requestId);
      this.carRequests.settle();
      return { ok: true, value: cars };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost', requestId };
      }
      this.carRequests.settle();
      return this.refusalOrRethrow(error);
    }
  }

  async listCars(): Promise<DriverSignInClientResult<readonly string[]>> {
    if (this.session === undefined) {
      return { ok: false, error: 'not signed in' };
    }

    try {
      return { ok: true, value: await this.api.listCars() };
    } catch (error) {
      if (error instanceof ServerTransportError) {
        return { ok: false, error: 'connection lost' };
      }
      return this.refusalOrRethrow(error);
    }
  }

  /** A refusal from the server goes to the screen; anything else is a fault and is not hidden. */
  private refusalOrRethrow(error: unknown): DriverSignInClientFailure {
    if (error instanceof DriverAuthRefusedError) {
      if (error.refusal === 'not signed in') {
        this.session = undefined;
      }
      return { ok: false, error: error.refusal };
    }
    throw error;
  }
}
