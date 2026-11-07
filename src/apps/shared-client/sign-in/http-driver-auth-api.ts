/**
 * DriverAuthApi adapter: the Driver App talks to the main system only through the HTTP entry point.
 * No sign-in or car rules here: the server's answers are mapped to results, refusals or transport errors. The refusal
 * is read from the answer's `error` word, never from the status code alone, because the status codes of the sign-in
 * routes are the owner's to choose.
 */
import type { RequestId } from '../../../shared/request-id';
import { asRecord, requiredList, requiredString } from '../server-answer';
import { asTransportFailureIfServerFailed, ServerCall, ServerRefusedError, UNAUTHORIZED, type EntryPointHandle } from '../server-call';
import {
  DriverAuthRefusedError,
  isSaveCarRefusal,
  isSignInRefusal,
  type DriverAuthApi,
  type SignInSuccess,
} from './driver-auth-api';
import { DRIVER_CARS_PATH, DRIVER_REQUEST_CODE_PATH, DRIVER_SIGN_IN_PATH } from './driver-auth-routes';

export interface HttpDriverAuthApiOptions {
  readonly handle: EntryPointHandle;
}

export class HttpDriverAuthApi implements DriverAuthApi {
  private readonly server: ServerCall;
  /** The token from the last sign-in. The server checks it on every call; the app only carries it. */
  private token: string | undefined;

  constructor(options: HttpDriverAuthApiOptions) {
    this.server = new ServerCall({ handle: options.handle, token: () => this.token });
  }

  async requestCode(phone: string, requestId: RequestId): Promise<void> {
    await this.server.write(DRIVER_REQUEST_CODE_PATH, requestId, { phone }).catch(rethrowAsDriverAuthRefusal);
  }

  async signIn(phone: string, code: string, requestId: RequestId): Promise<SignInSuccess> {
    const answer = await this.server.write(DRIVER_SIGN_IN_PATH, requestId, { phone, code }).catch(rethrowAsDriverAuthRefusal);
    this.token = requiredString(answer, 'token');
    return { token: this.token };
  }

  async saveCar(plate: string, requestId: RequestId): Promise<readonly string[]> {
    this.requireSignIn();
    const answer = await this.server.write(DRIVER_CARS_PATH, requestId, { plate }).catch(rethrowAsDriverAuthRefusal);
    requiredString(answer, 'carRef');
    return this.listCars();
  }

  async listCars(): Promise<readonly string[]> {
    this.requireSignIn();
    const answer = await this.server.read(DRIVER_CARS_PATH, {}).catch(rethrowAsDriverAuthRefusal);
    return requiredList(answer, 'cars').map((car) => requiredString(asRecord(car), 'plate'));
  }

  /** Without a token the server would refuse anyway; refusing here spares the call and names the reason the same way. */
  private requireSignIn(): void {
    if (this.token === undefined) {
      throw new DriverAuthRefusedError('not signed in');
    }
  }
}

/** The server's "no" as the screen names it; a refusal word this app does not know is a fault and is not hidden. */
function rethrowAsDriverAuthRefusal(error: unknown): never {
  if (error instanceof ServerRefusedError) {
    if (isSignInRefusal(error.refusal) || isSaveCarRefusal(error.refusal)) {
      throw new DriverAuthRefusedError(error.refusal);
    }
    if (error.status === UNAUTHORIZED) {
      throw new DriverAuthRefusedError('not signed in');
    }
  }
  return asTransportFailureIfServerFailed(error);
}
