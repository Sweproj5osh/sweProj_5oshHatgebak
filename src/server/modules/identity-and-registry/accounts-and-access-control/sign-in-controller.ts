import { refuse, respond, type PublicWriteOperation, type WriteOutcome } from '../../../shared/operation-contract';
import type { Result } from '../../../shared/result';
import type { TableAccess } from '../../../shared/unit-of-work';
import { createAccountsStores, type AccountsAndAccessControl, type SignedIn, type SignInRefusal } from './index';
import { hashOfCode, minutesAfter, SIGN_IN_POLICY } from './domain/one-time-code';
import { seedPerson } from './controller-support';

export const REQUEST_SIGN_IN_CODE_PATH = '/sign-in-codes';

export const SIGN_IN_PATH = '/sessions';

export const SIGN_IN_WITH_SECOND_STEP_PATH = '/committee-sessions';

/** The one public sign-in operation name (F13), served at two paths: the phone and code, or those plus the committee's password. */
const SIGN_IN_OPERATION = 'signIn';

/** Any Egyptian mobile number is answered the same way and gets a code: the door never says who is registered (P3). */
export function requestSignInCode(accounts: AccountsAndAccessControl): PublicWriteOperation {
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
 * The driver's, attendant's and inspector's sign-in: the phone and its code, as the apps send them. A member or the
 * Chair is answered "second step required" here and signs in at the second path. A phone nobody registered becomes a
 * driver inside this write's unit of work (P3), answered 201; the entry carries the person reference, never the phone.
 */
export function signIn(accounts: AccountsAndAccessControl, signInCodeSecret: string): PublicWriteOperation {
  return {
    kind: 'public',
    name: SIGN_IN_OPERATION,
    method: 'POST',
    path: SIGN_IN_PATH,
    bodySchema: { fields: { phone: 'string', code: 'string' } },
    audit: { omit: ['code'], replace: { phone: 'personId' } },
    rateLimitKey: 'phone',
    examples: { valid: { phone: SAMPLE_SIGN_IN.phone, code: SAMPLE_SIGN_IN.code }, invalid: { phone: 1 } },
    fixture: (database) => seedSampleSignIn(database, signInCodeSecret),
    handle: ({ body, transaction }) => signedInOutcome(accounts.signIn.signIn(transaction, String(body['phone']), String(body['code']))),
  };
}

/**
 * The committee's two-step sign-in (task A15): the same `signIn` operation (F13 allows no third public name) with the
 * password as the second factor, at its own path so that the one-step body stays exactly what the Driver App sends.
 */
export function signInWithSecondStep(accounts: AccountsAndAccessControl, signInCodeSecret: string): PublicWriteOperation {
  return {
    kind: 'public',
    name: SIGN_IN_OPERATION,
    method: 'POST',
    path: SIGN_IN_WITH_SECOND_STEP_PATH,
    bodySchema: { fields: { phone: 'string', code: 'string', password: 'string' } },
    audit: { omit: ['code', 'password'], replace: { phone: 'personId' } },
    rateLimitKey: 'phone',
    examples: { valid: { phone: SAMPLE_SIGN_IN.phone, code: SAMPLE_SIGN_IN.code, password: 'not needed for a driver' }, invalid: { phone: 1 } },
    fixture: (database) => seedSampleSignIn(database, signInCodeSecret),
    handle: ({ body, transaction }) =>
      signedInOutcome(accounts.signIn.signInWithSecondStep(transaction, String(body['phone']), String(body['code']), String(body['password']))),
  };
}

async function signedInOutcome(attempt: Promise<Result<SignedIn, SignInRefusal>>): Promise<WriteOutcome> {
  const signedIn = await attempt;
  if (!signedIn.ok) {
    return { response: refuse(SIGN_IN_REFUSAL_STATUS[signedIn.error], signedIn.error) };
  }
  const { token, personId, registered } = signedIn.value;
  return { response: respond(registered ? 201 : 200, { token }), audit: { subjectPersonIds: [personId], references: { personId } } };
}

async function seedSampleSignIn(database: TableAccess, signInCodeSecret: string): Promise<void> {
  await seedPerson(database, SAMPLE_SIGN_IN.personId, 'driver', SAMPLE_SIGN_IN.phone);
  await createAccountsStores().signInChallenges.save(database, {
    phone: SAMPLE_SIGN_IN.phone,
    personId: SAMPLE_SIGN_IN.personId,
    codeHash: hashOfCode(signInCodeSecret, SAMPLE_SIGN_IN.phone, SAMPLE_SIGN_IN.code),
    expiresAt: minutesAfter(new Date(), SIGN_IN_POLICY.codeLifetimeMinutes).toISOString(),
    failedAttempts: 0,
  });
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
