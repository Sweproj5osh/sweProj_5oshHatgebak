/**
 * Stand-in server side of D1 for integration tests, until Lino's sign-in and add-car requests are registered on main
 * (P14: imported by test files only, deleted the day the real operation is on main).
 *
 * This is not the accounts module: it copies just enough of Lino's published behaviour for the Driver App to be
 * exercised through the real entry point pipeline, with the real request ids, repeat store, rate limits and the one
 * redacted audit entry per write:
 * - `createStandInSignInOperations`: `requestSignInCode` and `signIn`, the two public operations of P3 (ADR-15), at
 *   the paths Lino registers (POST /sign-in/code with the phone, POST /sign-in with the phone and the code);
 * - `createStandInCarOperations`: GET /cars as Lino answers it and POST /cars as this app proposes it.
 *
 * Copied from Lino on purpose, so the tests refuse what the server will refuse: three wrong codes lock the phone, an
 * unknown phone is answered "wrong code", and a plate is upper-cased with spaces and dashes removed, then must be one
 * to ten English letters or digits. Saving the same plate twice returns the car already saved. Answering a repeated
 * request id is the pipeline's job, so the stand-in keeps no answers.
 */
import type { PersonId } from '../../shared/identifiers';
import {
  refuse,
  respond,
  type Operation,
  type PublicWriteOperation,
  type ReadOperation,
  type WriteOperation,
  type WriteOutcome,
} from '../../shared/operation-contract';
import type { TokenIssuer } from '../../shared/token-issuer';
import {
  DRIVER_ADD_CAR_OPERATION,
  DRIVER_CARS_PATH,
  DRIVER_OWN_CARS_OPERATION,
  DRIVER_REQUEST_CODE_PATH,
  DRIVER_SIGN_IN_PATH,
  REQUEST_SIGN_IN_CODE_OPERATION,
  SIGN_IN_OPERATION,
} from '../shared-client/sign-in/driver-auth-routes';

const WRONG_CODES_BEFORE_LOCK_OUT = 3;
const PLATE = /^[A-Z0-9]{1,10}$/;
const CODE_LENGTH = 6;

interface Challenge {
  readonly code: string;
  failedAttempts: number;
  locked: boolean;
}

interface StoredCar {
  readonly carRef: string;
  readonly plate: string;
}

export interface StandInAccountsState {
  /** The entry point's own issuer, so the token the stand-in hands out is one the real pipeline accepts. */
  readonly tokens: TokenIssuer;
  readonly driverByPhone: Map<string, PersonId>;
  readonly challenges: Map<string, Challenge>;
  readonly sentCodes: { readonly phone: string; readonly code: string }[];
  readonly carsByDriver: Map<PersonId, StoredCar[]>;
  carsSaved: number;
  tokensIssued: number;
  nextCode: number;
}

/**
 * The phones given are registered drivers (driver-1, driver-2, … in that order); any other phone is unknown to the
 * server. A person reference never derives from the phone: it ends up in audit entries as the subject (Rule F).
 */
export function createStandInAccountsState(tokens: TokenIssuer, registeredPhones: readonly string[]): StandInAccountsState {
  return {
    tokens,
    driverByPhone: new Map(registeredPhones.map((phone, index) => [phone, `driver-${index + 1}`])),
    challenges: new Map(),
    sentCodes: [],
    carsByDriver: new Map(),
    carsSaved: 0,
    tokensIssued: 0,
    nextCode: 1,
  };
}

/** What the fake code sender recorded: the screen cannot see it, so a test reads it here. */
export function lastCodeSentTo(state: StandInAccountsState, phone: string): string | undefined {
  return state.sentCodes.filter((sent) => sent.phone === phone).at(-1)?.code;
}

export function createStandInSignInOperations(state: StandInAccountsState): readonly Operation[] {
  return [requestSignInCode(state), signIn(state)];
}

/** The same answer for every phone, so the screen never reveals who is registered. The entry never holds the phone. */
function requestSignInCode(state: StandInAccountsState): PublicWriteOperation {
  return {
    kind: 'public',
    name: REQUEST_SIGN_IN_CODE_OPERATION,
    method: 'POST',
    path: DRIVER_REQUEST_CODE_PATH,
    bodySchema: { fields: { phone: 'string' } },
    audit: { omit: ['phone'] },
    rateLimitKey: 'phone',
    examples: { valid: { phone: '01012345678' }, invalid: {} },
    async handle({ body }) {
      sendCodeIfRegistered(state, String(body['phone']));
      return { response: respond(202, {}) };
    },
  };
}

function signIn(state: StandInAccountsState): PublicWriteOperation {
  return {
    kind: 'public',
    name: SIGN_IN_OPERATION,
    method: 'POST',
    path: DRIVER_SIGN_IN_PATH,
    bodySchema: { fields: { phone: 'string', code: 'string' } },
    audit: { omit: ['phone', 'code'] },
    rateLimitKey: 'phone',
    examples: { valid: { phone: '01012345678', code: '000001' }, invalid: { phone: '01012345678' } },
    async handle({ body }) {
      return judgeCode(state, String(body['phone']), String(body['code']));
    },
  };
}

function sendCodeIfRegistered(state: StandInAccountsState, phone: string): void {
  if (!state.driverByPhone.has(phone)) {
    return;
  }
  const code = String(state.nextCode++).padStart(CODE_LENGTH, '0');
  state.challenges.set(phone, { code, failedAttempts: 0, locked: false });
  state.sentCodes.push({ phone, code });
}

function judgeCode(state: StandInAccountsState, phone: string, code: string): WriteOutcome {
  const driverId = state.driverByPhone.get(phone);
  const challenge = state.challenges.get(phone);
  if (driverId === undefined || challenge === undefined) {
    return { response: refuse(401, 'wrong code') };
  }
  if (challenge.locked) {
    return { response: refuse(423, 'locked') };
  }
  if (code !== challenge.code) {
    return { response: recordWrongCode(challenge) };
  }
  state.challenges.delete(phone);
  state.tokensIssued += 1;
  const token = state.tokens.issue({ personId: driverId, role: 'driver' });
  return { response: respond(200, { token }), audit: { subjectPersonIds: [driverId] } };
}

function recordWrongCode(challenge: Challenge) {
  challenge.failedAttempts += 1;
  if (challenge.failedAttempts >= WRONG_CODES_BEFORE_LOCK_OUT) {
    challenge.locked = true;
    return refuse(423, 'locked');
  }
  return refuse(401, 'wrong code');
}

export function createStandInCarOperations(state: StandInAccountsState): readonly Operation[] {
  return [ownCars(state), addCar(state)];
}

/** Lino's `personalData.ownCars`: the driver's own cars, each with its reference and its plate. */
function ownCars(state: StandInAccountsState): ReadOperation {
  return {
    kind: 'read',
    name: DRIVER_OWN_CARS_OPERATION,
    method: 'GET',
    path: DRIVER_CARS_PATH,
    allowedRoles: ['driver'],
    scope: 'own',
    async handle({ actor }) {
      return respond(200, { cars: state.carsByDriver.get(actor.personId) ?? [] });
    },
  };
}

/** This app's proposal for `personalData.addCar`: the plate travels in the body and the entry keeps only the reference (P2). */
function addCar(state: StandInAccountsState): WriteOperation {
  return {
    kind: 'write',
    name: DRIVER_ADD_CAR_OPERATION,
    method: 'POST',
    path: DRIVER_CARS_PATH,
    allowedRoles: ['driver'],
    bodySchema: { fields: { plate: 'string' } },
    audit: { replace: { plate: 'carRef' } },
    examples: { valid: { plate: 'ABC123' }, invalid: { plate: 1 } },
    async handle(context) {
      const plate = String(context.body['plate']).toUpperCase().replace(/[\s-]/g, '');
      if (!PLATE.test(plate)) {
        return { response: refuse(400, 'invalid plate') };
      }
      const car = findOrSaveCar(state, context.actor.personId, plate);
      return { response: respond(201, { carRef: car.carRef }), audit: { references: { carRef: car.carRef } } };
    },
  };
}

function findOrSaveCar(state: StandInAccountsState, driverId: PersonId, plate: string): StoredCar {
  const cars = state.carsByDriver.get(driverId) ?? [];
  const existing = cars.find((car) => car.plate === plate);
  if (existing !== undefined) {
    return existing;
  }
  state.carsSaved += 1;
  const car = { carRef: `car-${state.carsSaved}`, plate };
  state.carsByDriver.set(driverId, [...cars, car]);
  return car;
}
