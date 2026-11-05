/**
 * The Driver App's view of sign-in and cars. The real adapter calls the main system over HTTP;
 * tests use an in-memory stand-in until Teammate A's A1/A4 routes are registered.
 */
import type { PersonId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';

export interface SignInSuccess {
  readonly driverId: PersonId;
  readonly token: string;
}

export type SignInRefusal = 'wrong code' | 'locked out' | 'unknown phone';

export class DriverAuthTransportError extends Error {
  constructor(message = 'connection lost before the answer arrived') {
    super(message);
    this.name = 'DriverAuthTransportError';
  }
}

export interface DriverAuthApi {
  requestCode(phone: string, requestId: RequestId): Promise<void>;
  signIn(phone: string, code: string, requestId: RequestId): Promise<SignInSuccess>;
  saveCar(plate: string, requestId: RequestId): Promise<readonly string[]>;
  listCars(): Promise<readonly string[]>;
}
