import { isRole, type PersonId, type Role } from '../../../shared/identifiers';
import {
  refuse,
  respond,
  type Operation,
  type PublicWriteOperation,
  type ReadOperation,
  type WriteOperation,
} from '../../../shared/operation-contract';
import type { TableAccess } from '../../../shared/unit-of-work';
import {
  createAccountsStores,
  type AccountsAndAccessControl,
  type CarRefusal,
  type CreatePersonRefusal,
  type ErasureRefusal,
  type PasswordRefusal,
  type SignInRefusal,
} from '../public';
import { hashOfCode, minutesAfter, SIGN_IN_POLICY } from './domain/one-time-code';

export interface AccountsOperationsDependencies {
  readonly accounts: AccountsAndAccessControl;
  /** The secret the module keys code hashes with; the sign-in sample of the F5 harness seeds a code hashed the same way. */
  readonly signInCodeSecret: string;
}

/**
 * The requests this module answers, for the composition root to register (P4). The entry point checks the token, the
 * role, the scope, the request id and the body before a handler runs, and writes the one redacted audit entry after it
 * succeeds (ADR-14); a handler only names the subject and returns the references that stand in for personal fields.
 * Sign-in is the one door without a token: the two public operations of ADR-15, at the paths the apps call.
 */
export function accountsOperations({ accounts, signInCodeSecret }: AccountsOperationsDependencies): readonly Operation[] {
  return [
    requestSignInCode(accounts),
    signIn(accounts, signInCodeSecret),
    createPerson(accounts),
    addCar(accounts),
    setCommitteePassword(accounts),
    erasePerson(accounts),
    readOwnCars(accounts),
    lookUpPlate(accounts),
  ];
}

export const REQUEST_SIGN_IN_CODE_PATH = '/sign-in/code';
export const SIGN_IN_PATH = '/sign-in';

/** An unknown phone is answered exactly like a known one, so the door never says who is registered. */
function requestSignInCode(accounts: AccountsAndAccessControl): PublicWriteOperation {
  return {
    kind: 'public',
    name: 'requestSignInCode',
    method: 'POST',
    path: REQUEST_SIGN_IN_CODE_PATH,
    bodySchema: { fields: { phone: 'string' } },
    audit: { omit: ['phone'] },
    rateLimitKey: 'phone',
    examples: { valid: { phone: '01012345678' }, invalid: {} },
    async handle({ body }) {
      const requested = await accounts.signIn.requestSignInCode(String(body['phone']));
      return requested.ok ? { response: respond(202, { accepted: true }) } : { response: refuse(SIGN_IN_REFUSAL_STATUS.locked, requested.error) };
    },
  };
}

/** The sample sign-in the F5 harness runs: a driver with this phone and an outstanding code, seeded by the fixture. */
const SAMPLE_SIGN_IN = { personId: 'person-sign-in-sample', phone: '+201098765432', code: '246810' };

/**
 * One operation signs everyone in (F13 allows no third public name): drivers, attendants and inspectors send an empty
 * password; members and the Chair send theirs as the second step (task A15).
 */
function signIn(accounts: AccountsAndAccessControl, signInCodeSecret: string): PublicWriteOperation {
  return {
    kind: 'public',
    name: 'signIn',
    method: 'POST',
    path: SIGN_IN_PATH,
    bodySchema: { fields: { phone: 'string', code: 'string', password: 'string' } },
    audit: { omit: ['phone', 'code', 'password'] },
    rateLimitKey: 'phone',
    examples: { valid: { phone: SAMPLE_SIGN_IN.phone, code: SAMPLE_SIGN_IN.code, password: '' }, invalid: { phone: 1 } },
    async fixture(database) {
      await seedPerson(database, SAMPLE_SIGN_IN.personId, 'driver', SAMPLE_SIGN_IN.phone);
      await createAccountsStores().signInChallenges.save(database, {
        phone: SAMPLE_SIGN_IN.phone,
        personId: SAMPLE_SIGN_IN.personId,
        codeHash: hashOfCode(signInCodeSecret, SAMPLE_SIGN_IN.phone, SAMPLE_SIGN_IN.code),
        expiresAt: minutesAfter(new Date(), SIGN_IN_POLICY.codeLifetimeMinutes).toISOString(),
        failedAttempts: 0,
      });
    },
    async handle({ body }) {
      const phone = String(body['phone']);
      const code = String(body['code']);
      const password = String(body['password']);
      const signedIn = password === '' ? await accounts.signIn.signIn(phone, code) : await accounts.signIn.signInWithSecondStep(phone, code, password);
      if (!signedIn.ok) {
        return { response: refuse(SIGN_IN_REFUSAL_STATUS[signedIn.error], signedIn.error) };
      }
      return { response: respond(200, { token: signedIn.value.token }), audit: { subjectPersonIds: [signedIn.value.personId] } };
    },
  };
}

const SIGN_IN_REFUSAL_STATUS: Readonly<Record<SignInRefusal, number>> = {
  'wrong code': 401,
  locked: 423,
  'code expired': 401,
  'account not live': 403,
  'second step required': 401,
  'wrong password': 401,
  'password not set': 403,
};

/**
 * Staff creating staff below them in the hierarchy. The phone and the name never reach the audit entry: both are
 * replaced by the new person's reference (P2, ADR-14).
 */
function createPerson(accounts: AccountsAndAccessControl): WriteOperation {
  return {
    kind: 'write',
    name: 'personalData.createPerson',
    method: 'POST',
    path: '/people',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { role: 'string', phone: 'string', displayName: 'string' } },
    audit: { replace: { phone: 'personId', displayName: 'personId' } },
    examples: { valid: { role: 'attendant', phone: '01012345679', displayName: 'An Attendant' }, invalid: { role: 'attendant' } },
    fixture: (database) => seedPerson(database, 'member-1', 'member', '+201011111111'),
    async handle({ actor, body }) {
      const role = body['role'];
      if (!isRole(role)) {
        return { response: refuse(400, 'unknown role') };
      }
      const created = await accounts.personalData.createPerson(actor.personId, role, String(body['phone']), String(body['displayName']));
      if (!created.ok) {
        return { response: refuse(CREATE_PERSON_REFUSAL_STATUS[created.error], created.error) };
      }
      return {
        response: respond(201, { personId: created.value }),
        audit: { subjectPersonIds: [created.value], references: { personId: created.value } },
      };
    },
  };
}

const CREATE_PERSON_REFUSAL_STATUS: Readonly<Record<CreatePersonRefusal, number>> = {
  'not allowed to create this role': 403,
  'invalid phone': 400,
  'invalid name': 400,
  'phone already registered': 409,
};

/** A driver saves a car; the audit entry keeps the car reference in place of the plate (P2). */
function addCar(accounts: AccountsAndAccessControl): WriteOperation {
  return {
    kind: 'write',
    name: 'personalData.addCar',
    method: 'POST',
    path: '/cars',
    allowedRoles: ['driver'],
    bodySchema: { fields: { plate: 'string' } },
    audit: { replace: { plate: 'carRef' } },
    examples: { valid: { plate: 'ABC 123' }, invalid: {} },
    fixture: (database) => seedPerson(database, 'driver-1', 'driver', '+201022222222'),
    async handle({ actor, body }) {
      const added = await accounts.personalData.addCar(actor.personId, String(body['plate']));
      if (!added.ok) {
        return { response: refuse(CAR_REFUSAL_STATUS[added.error], added.error) };
      }
      return { response: respond(201, { carRef: added.value }), audit: { references: { carRef: added.value } } };
    },
  };
}

const CAR_REFUSAL_STATUS: Readonly<Record<CarRefusal, number>> = { 'not a driver': 403, 'invalid plate': 400 };

/** The committee's second step (task A15): the password is dropped from the audit entry (P2). */
function setCommitteePassword(accounts: AccountsAndAccessControl): WriteOperation {
  return {
    kind: 'write',
    name: 'signIn.setCommitteePassword',
    method: 'POST',
    path: '/committee/password',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { personId: 'string', password: 'string' } },
    audit: { omit: ['password'] },
    examples: { valid: { personId: 'member-1', password: 'correct horse battery staple' }, invalid: { personId: 'member-1' } },
    fixture: (database) => seedPerson(database, 'member-1', 'member', '+201011111111'),
    async handle({ actor, body }) {
      const personId = String(body['personId']);
      const set = await accounts.signIn.setCommitteePassword(actor.personId, personId, String(body['password']));
      if (!set.ok) {
        return { response: refuse(PASSWORD_REFUSAL_STATUS[set.error], set.error) };
      }
      return { response: respond(200, { personId }), audit: { subjectPersonIds: [personId] } };
    },
  };
}

const PASSWORD_REFUSAL_STATUS: Readonly<Record<PasswordRefusal, number>> = {
  'not a committee member': 400,
  'not allowed': 403,
  'password too short': 400,
  'password too long': 400,
};

/**
 * The body holds only the person reference, so the audit entry keeps no personal data. The entry names the erased
 * person as its subject, so the record of the erasure itself survives under the pseudonym.
 */
function erasePerson(accounts: AccountsAndAccessControl): WriteOperation {
  return {
    kind: 'write',
    name: 'personalData.erase',
    method: 'POST',
    path: '/people/erasure',
    allowedRoles: ['driver', 'chair'],
    bodySchema: { fields: { personId: 'string' } },
    examples: { valid: { personId: 'driver-1' }, invalid: {} },
    fixture: (database) => seedPerson(database, 'driver-1', 'driver', '+201022222222'),
    async handle({ actor, body }) {
      const personId = String(body['personId']);
      const erased = await accounts.personalData.erase(actor.personId, personId);
      if (!erased.ok) {
        return { response: refuse(ERASURE_REFUSAL_STATUS[erased.error], erased.error) };
      }
      return { response: respond(200, erased.value), audit: { subjectPersonIds: [personId] } };
    },
  };
}

const ERASURE_REFUSAL_STATUS: Readonly<Record<ErasureRefusal, number>> = {
  'not allowed': 403,
  'unknown person': 404,
  'already erased': 409,
};

/** A driver's own cars, for the driver's own screen: one's own data, so nothing for accountability to gain (P9). */
function readOwnCars(accounts: AccountsAndAccessControl): ReadOperation {
  return {
    kind: 'read',
    name: 'personalData.ownCars',
    method: 'GET',
    path: '/cars',
    allowedRoles: ['driver'],
    scope: 'own',
    logged: false,
    async handle({ actor }) {
      return { response: respond(200, { cars: await accounts.personalData.ownCars(actor.personId) }) };
    },
  };
}

/**
 * An inspector's (or committee member's) plate look-up at a site in their scope (Rule F, P9): a logged read, so the
 * pipeline requires a request id and writes the one audit entry naming the reader, the car reference and the owner.
 */
function lookUpPlate(accounts: AccountsAndAccessControl): ReadOperation {
  return {
    kind: 'read',
    name: 'personalData.lookUpPlate',
    method: 'GET',
    path: '/plates/look-up',
    allowedRoles: ['inspector', 'member', 'chair'],
    scope: 'staff-scoped',
    logged: true,
    audit: { touchesPersonalData: true },
    async handle({ actor, query }) {
      const served = await accounts.personalData.readPlate({
        carRef: query['carRef'] ?? '',
        siteId: query['siteId'] ?? '',
        reader: actor.personId,
        purpose: 'inspector look-up',
      });
      if (!served.ok) {
        return { response: refuse(served.error === 'refused' ? 403 : 404, served.error) };
      }
      const { plate, ownerRef, districtId } = served.value;
      return {
        response: respond(200, { plate }),
        audit: districtId === undefined ? { subjectPersonIds: [ownerRef] } : { subjectPersonIds: [ownerRef], districtId },
      };
    },
  };
}

/** Seeds the person a sample request of the F5 harness acts as, or acts on, through this module's own stores (P26 Q10). */
export async function seedPerson(database: TableAccess, personId: PersonId, role: Role, phone: string): Promise<void> {
  const stores = createAccountsStores();
  await stores.people.add(database, { personId, role, status: 'active', erased: false });
  await stores.personalData.addDetails(database, { personRef: personId, displayName: `${role} ${personId}`, phone });
}
