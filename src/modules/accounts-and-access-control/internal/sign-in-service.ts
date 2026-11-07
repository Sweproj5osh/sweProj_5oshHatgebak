import type { Clock } from '../../../shared/clock';
import type { PersonId } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import type { TokenIssuer } from '../../../shared/token-issuer';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { Authorization, PasswordRefusal, SignIn, SignInCodeSender, SignInRefusal, SignedIn } from '../public';
import { codeMatches, hashOfCode, minutesAfter, newOneTimeCode, SIGN_IN_POLICY } from './domain/one-time-code';
import { hashPassword, needsSecondStep, passwordLengthProblem, passwordMatches } from './domain/password';
import { normalisePhone } from './domain/person';
import type { CommitteePasswordStore, PeopleStore, PersonalDataStore, SignInChallenge, SignInChallengeStore } from './ports';

export interface SignInDependencies {
  /** The committed tables, for every call that does not arrive with a unit of work (see QUESTIONS.md item 23). */
  readonly database: TableAccess;
  readonly people: PeopleStore;
  readonly personalData: PersonalDataStore;
  readonly challenges: SignInChallengeStore;
  readonly passwords: CommitteePasswordStore;
  readonly authorization: Authorization;
  readonly codeSender: SignInCodeSender;
  readonly tokenIssuer: TokenIssuer;
  /** Keys the hash kept in place of each code (P23). */
  readonly codeHashSecret: string;
  readonly clock: Clock;
}

/**
 * Sign-in by phone and one-time code (task A1). Three wrong codes lock the phone out for fifteen minutes; the count is
 * kept per phone and survives a new code request, and a locked phone is refused a new code (P23). An unknown phone gets
 * the same answers as a wrong code, so the sign-in screen never reveals who is registered. Members and the Chair also
 * need their password (task A15); a wrong password counts towards the same lock-out as a wrong code.
 */
export class SignInService implements SignIn {
  constructor(private readonly dependencies: SignInDependencies) {}

  async requestSignInCode(phone: string): Promise<Result<void, 'locked'>> {
    const normalisedPhone = normalisePhone(phone);
    const personId = normalisedPhone.ok ? await this.dependencies.personalData.personWithPhone(this.database, normalisedPhone.value) : undefined;
    if (!normalisedPhone.ok || personId === undefined) {
      return succeed(undefined);
    }
    const now = this.dependencies.clock.now();
    const earlier = await this.dependencies.challenges.find(this.database, normalisedPhone.value);
    if (earlier !== undefined && isLocked(earlier, now)) {
      return fail('locked');
    }
    const code = newOneTimeCode();
    await this.dependencies.challenges.save(this.database, {
      phone: normalisedPhone.value,
      personId,
      codeHash: hashOfCode(this.dependencies.codeHashSecret, normalisedPhone.value, code),
      expiresAt: minutesAfter(now, SIGN_IN_POLICY.codeLifetimeMinutes).toISOString(),
      failedAttempts: failedAttemptsCarriedOver(earlier),
    });
    await this.dependencies.codeSender.send(normalisedPhone.value, code);
    return succeed(undefined);
  }

  async signIn(phone: string, code: string): Promise<Result<SignedIn, SignInRefusal>> {
    return this.signInWith(phone, code, undefined);
  }

  async signInWithSecondStep(phone: string, code: string, password: string): Promise<Result<SignedIn, SignInRefusal>> {
    return this.signInWith(phone, code, password);
  }

  /** The person themself sets or changes their password; the Chair sets a member's first one or resets it. */
  async setCommitteePassword(actor: PersonId, personId: PersonId, password: string): Promise<Result<void, PasswordRefusal>> {
    const person = await this.dependencies.people.find(this.database, personId);
    if (person === undefined || !needsSecondStep(person.role)) {
      return fail('not a committee member');
    }
    const actorRole = await this.dependencies.authorization.roleOf(actor);
    const chairResettingMember = actorRole === 'chair' && person.role === 'member';
    if (actor !== personId && !chairResettingMember) {
      return fail('not allowed');
    }
    const lengthProblem = passwordLengthProblem(password);
    if (lengthProblem !== undefined) {
      return fail(lengthProblem);
    }
    await this.dependencies.passwords.save(this.database, personId, await hashPassword(password));
    return succeed(undefined);
  }

  private async signInWith(phone: string, code: string, password: string | undefined): Promise<Result<SignedIn, SignInRefusal>> {
    const normalisedPhone = normalisePhone(phone);
    const challenge = normalisedPhone.ok ? await this.dependencies.challenges.find(this.database, normalisedPhone.value) : undefined;
    if (challenge === undefined) {
      return fail('wrong code');
    }
    const now = this.dependencies.clock.now();
    if (isLocked(challenge, now)) {
      return fail('locked');
    }
    if (new Date(challenge.expiresAt) <= now) {
      return fail('code expired');
    }
    if (!codeMatches(this.dependencies.codeHashSecret, challenge.phone, code, challenge.codeHash)) {
      return this.recordFailedAttempt(challenge, now, 'wrong code');
    }
    const secondStep = await this.checkSecondStep(challenge.personId, password);
    if (secondStep !== undefined) {
      return secondStep === 'wrong password' ? this.recordFailedAttempt(challenge, now, 'wrong password') : fail(secondStep);
    }
    await this.dependencies.challenges.remove(this.database, challenge.phone);
    return this.issueToken(challenge.personId);
  }

  /** undefined when no second step is needed or the password is right; the code stays usable otherwise. */
  private async checkSecondStep(personId: PersonId, password: string | undefined): Promise<SignInRefusal | undefined> {
    const person = await this.dependencies.people.find(this.database, personId);
    if (person === undefined || !needsSecondStep(person.role)) {
      return undefined;
    }
    if (password === undefined || password === '') {
      return 'second step required';
    }
    const stored = await this.dependencies.passwords.find(this.database, personId);
    if (stored === undefined) {
      return 'password not set';
    }
    return (await passwordMatches(password, stored)) ? undefined : 'wrong password';
  }

  private async recordFailedAttempt(
    challenge: SignInChallenge,
    now: Date,
    refusal: 'wrong code' | 'wrong password',
  ): Promise<Result<never, SignInRefusal>> {
    const failedAttempts = challenge.failedAttempts + 1;
    if (failedAttempts < SIGN_IN_POLICY.wrongCodesBeforeLockOut) {
      await this.dependencies.challenges.save(this.database, { ...challenge, failedAttempts });
      return fail(refusal);
    }
    await this.dependencies.challenges.save(this.database, {
      ...challenge,
      failedAttempts,
      lockedUntil: minutesAfter(now, SIGN_IN_POLICY.lockOutMinutes).toISOString(),
    });
    return fail('locked');
  }

  /** The token names one person and one role, plus a member's district; every claim is set here by the server. */
  private async issueToken(personId: PersonId): Promise<Result<SignedIn, SignInRefusal>> {
    const person = await this.dependencies.people.find(this.database, personId);
    if (person === undefined || (await this.dependencies.authorization.liveStatus(personId)) !== 'active') {
      return fail('account not live');
    }
    const districtId = person.role === 'member' ? await this.dependencies.authorization.memberDistrictOf(personId) : undefined;
    const token = this.dependencies.tokenIssuer.issue(
      districtId === undefined ? { personId, role: person.role } : { personId, role: person.role, districtId },
    );
    return succeed({ token, personId });
  }

  private get database(): TableAccess {
    return this.dependencies.database;
  }
}

function isLocked(challenge: SignInChallenge, now: Date): boolean {
  return challenge.lockedUntil !== undefined && new Date(challenge.lockedUntil) > now;
}

/** The wrong-code count survives a new code (P23); only a lock-out that has run its course clears it. */
function failedAttemptsCarriedOver(earlier: SignInChallenge | undefined): number {
  if (earlier === undefined || earlier.lockedUntil !== undefined) {
    return 0;
  }
  return earlier.failedAttempts;
}
