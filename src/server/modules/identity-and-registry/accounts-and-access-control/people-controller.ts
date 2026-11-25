import { isRole } from '../../../shared/identifiers';
import { refuse, respond, type WriteOperation } from '../../../shared/operation-contract';
import type { AccountsAndAccessControl, CreatePersonRefusal, ErasureRefusal, PasswordRefusal } from './index';
import { seedPerson } from './controller-support';
import { signIn } from './sign-in-controller';

/**
 * Staff creating staff below them in the hierarchy. The phone and the name never reach the audit entry: both are
 * replaced by the new person's reference (P2, ADR-14).
 */
export function createPerson(accounts: AccountsAndAccessControl): WriteOperation {
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

/** The committee's second step (task A15): the password is dropped from the audit entry (P2). */
export function setCommitteePassword(accounts: AccountsAndAccessControl): WriteOperation {
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
export function erasePerson(accounts: AccountsAndAccessControl): WriteOperation {
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
