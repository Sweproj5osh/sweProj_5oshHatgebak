/**
 * Accounts & Access Control — owner: Teammate A (Area 2). Must-stay-on set.
 * Identities, roles, the hierarchy Chair > Member > Inspector > Attendant, session binding to a site, sign-in through
 * the entry point's public operations, and the personal-data store with logged joins and erasure (ADR-06 Rule F).
 */
import type { Clock } from '../../shared/clock';
import type { DistrictId, PersonId, Role, SiteId, ZoneId } from '../../shared/identifiers';
import type { Result } from '../../shared/result';
import type { TokenIssuer } from '../../shared/token-issuer';
import type { TableAccess } from '../../shared/unit-of-work';
import {
  TableAccessFactsStore,
  TableCommitteePasswordStore,
  TablePeopleStore,
  TablePersonalDataStore,
  TableSignInChallengeStore,
} from './internal/adapters/table-stores';
import { AuthorizationService } from './internal/authorization-service';
import { SIGN_IN_POLICY as POLICY } from './internal/domain/one-time-code';
import { SCOPE_RULES } from './internal/domain/scope-rules';
import { PersonalDataService } from './internal/personal-data-service';
import type { AccessFactsStore, CommitteePasswordStore, PeopleStore, PersonalDataStore, SignInChallengeStore } from './internal/ports';
import { SignInService } from './internal/sign-in-service';

export interface Scope {
  readonly siteId?: SiteId;
  readonly zoneId?: ZoneId;
  readonly districtId?: DistrictId;
}

export type AccountStatus = 'active' | 'suspended' | 'revoked';

/** One answer of the scope rules, with the reason, for tracing a refusal. */
export interface AccessDecision {
  readonly operation: string;
  readonly allowed: boolean;
  readonly reason: string;
}

export type BindSessionRefusal = 'only an attendant clocks in' | 'account or licence not live' | 'not assigned to this site';

/**
 * Asked by the entry point on every request and by modules for scope (task A3). Every answer is read fresh: a licence
 * revoked a moment ago is refused on the very next call, with no new sign-in. The two writes take the caller's unit of
 * work first (ADR-13), so a clock-in binds the session in the same transaction as its attendance row.
 */
export interface Authorization {
  /** Chair everywhere; member in their district; inspector in their zone; attendant at their one site. */
  may(personId: PersonId, operation: string, scope: Scope): Promise<boolean>;
  explain(personId: PersonId, operation: string, scope: Scope): Promise<AccessDecision>;
  /** "active" only when the account is active and, for an attendant, the licence is valid. */
  liveStatus(personId: PersonId): Promise<AccountStatus>;
  roleOf(personId: PersonId): Promise<Role | undefined>;
  memberDistrictOf(personId: PersonId): Promise<DistrictId | undefined>;
  /** Called by attendance at clock-in, after the site's code was verified; the session then carries its proven site. */
  bindSessionToSite(transaction: TableAccess, personId: PersonId, siteId: SiteId): Promise<Result<void, BindSessionRefusal>>;
  unbindSession(transaction: TableAccess, personId: PersonId): Promise<void>;
  boundSite(personId: PersonId): Promise<SiteId | undefined>;
}

/** The licence states as this module needs them; the licensing module owns the licences themselves. */
export type LicenceLiveState = 'valid' | 'suspended' | 'revoked';

/**
 * Written by the licensing module, inside the same unit of work as its own change (ADR-13), so that this must-stay-on
 * module answers from its own table and never calls the may-fail licensing module (Rule D, fitness function F8).
 */
export interface AccessFacts {
  recordLicenceState(transaction: TableAccess, attendantId: PersonId, state: LicenceLiveState): Promise<void>;
  recordAttendantSite(transaction: TableAccess, attendantId: PersonId, siteId: SiteId): Promise<void>;
  clearAttendantSite(transaction: TableAccess, attendantId: PersonId): Promise<void>;
  recordInspectorZone(transaction: TableAccess, inspectorId: PersonId, zoneId: ZoneId): Promise<void>;
  recordMemberDistrict(transaction: TableAccess, memberId: PersonId, districtId: DistrictId): Promise<void>;
}

/**
 * Port: where a site or zone sits in the hierarchy. The composition root fills it from the site registry (P27 Q3), so
 * this module and sites-and-areas never import each other in a circle.
 */
export interface SiteLocator {
  locateSite(siteId: SiteId): Promise<{ readonly zoneId: ZoneId; readonly districtId: DistrictId } | undefined>;
  locateZone(zoneId: ZoneId): Promise<{ readonly districtId: DistrictId } | undefined>;
}

/**
 * Port: whether a car is, or was lately, parked at a site, answered by ticketing through the composition root. An
 * attendant or inspector is served a plate only for a car their site has actually seen, so naming the own site does
 * not open every plate in the city; the owner, the Chair and a Member in their district read for audits, every read logged.
 */
export interface CarPresence {
  carSeenAt(carRef: CarRef, siteId: SiteId): Promise<boolean>;
}

/** The scope rules in the order they are applied, for review and for the task A3 report. */
export const SCOPE_RULE_DESCRIPTIONS: readonly string[] = SCOPE_RULES.map((rule) => rule.description);

/** The reference of one car in the personal-data store. Other modules hold this, never the plate. */
export type CarRef = string;

/** Who is creating a person: a driver registering themself, or the staff member doing it. */
export type PersonCreator = 'self registration' | PersonId;

export type CreatePersonRefusal = 'not allowed to create this role' | 'invalid phone' | 'invalid name' | 'phone already registered';

export type CarRefusal = 'not a driver' | 'invalid plate';

/** Why a plate is being shown: the driver's receipt, the attendant's cash list, or an inspector's look-up. */
export type PlateReadPurpose = 'receipt' | 'cash list' | 'inspector look-up';

/** One request to see a plate: the car, who is reading, why, and the site of the ticket concerned. */
export interface PlateReadRequest {
  readonly carRef: CarRef;
  readonly reader: PersonId;
  readonly purpose: PlateReadPurpose;
  readonly siteId: SiteId;
}

/** "not resolvable": no such car, or its owner was erased; the ticket keeps the reference all the same. */
export type PlateReadRefusal = 'refused' | 'not resolvable';

/** A plate served by the logged join, with what the pipeline's audit entry names: the owner and the site's district. */
export interface ServedPlate {
  readonly plate: string;
  readonly ownerRef: PersonId;
  readonly districtId?: DistrictId;
}

/** A car as its own driver sees it. */
export interface OwnCar {
  readonly carRef: CarRef;
  readonly plate: string;
}

/** The car of an assisted ticket and the driver it belongs to: a registered driver, or a walk-in known only by this reference (P15). */
export interface WalkInCar {
  readonly carRef: CarRef;
  readonly driverRef: PersonId;
}

export type ResidencyRefusal = 'not allowed here' | 'unknown car';

export type ErasureRefusal = 'not allowed' | 'unknown person' | 'already erased';

/** What one erasure touched: rows deleted per table, and rows kept but marked erased per table. */
export interface ErasureReport {
  readonly rowsRemoved: Readonly<Record<string, number>>;
  readonly rowsMarked: Readonly<Record<string, number>>;
}

export interface PersonalData {
  createPerson(creator: PersonCreator, role: Role, phone: string, displayName: string): Promise<Result<PersonId, CreatePersonRefusal>>;
  /** Saves a car to a driver and returns its reference; ticketing holds the reference, never the plate (task A4). */
  addCar(driverId: PersonId, plate: string): Promise<Result<CarRef, CarRefusal>>;
  /**
   * The assisted ticket's car (P15, P28 #32): the car already saved under this plate, or a new car owned by a new
   * walk-in driver, created inside the caller's unit of work so the ticket and the car commit together (Rule E).
   */
  findOrCreateCarByPlate(transaction: TableAccess, plate: string): Promise<Result<WalkInCar, 'invalid plate'>>;
  /** Ticketing's ownership check before a driver opens a ticket for a car (P28 #32). */
  carBelongsTo(carRef: CarRef, personId: PersonId): Promise<boolean>;
  ownCars(driverId: PersonId): Promise<readonly OwnCar[]>;
  /**
   * The logged join (task A4, Rule F): the owner, or a reader whose role fits the purpose and who has scope over the
   * site, gets the plate. The one audit entry is written by the entry point's pipeline (P9): the read that calls this
   * declares `logged: true` and names the owner as the entry's subject; this module never appends an entry itself.
   */
  readPlate(request: PlateReadRequest): Promise<Result<ServedPlate, PlateReadRefusal>>;
  /** "Car X is registered at site Y" (P28 #31, task A16), written by a Member of the site's district or the Chair. */
  registerResidency(actor: PersonId, carRef: CarRef, siteId: SiteId): Promise<Result<void, ResidencyRefusal>>;
  /** Answered to the fee calculator through the composition root; nobody is a resident until a Member says so. */
  isResident(carRef: CarRef, siteId: SiteId): Promise<boolean>;
  /**
   * Deletes the person's name, phone, cars, plates and residencies (task A5). The reference stays, so tickets keep it
   * and remain whole, but it no longer resolves to anyone. A driver erases themself; the Chair erases anyone but a Chair.
   */
  erase(actor: PersonId, personId: PersonId): Promise<Result<ErasureReport, ErasureRefusal>>;
}

/**
 * "wrong code" also answers an unknown phone, so the sign-in screen never reveals who is registered.
 * "account not live" is a suspended or revoked account, or an attendant without a valid licence.
 */
export type SignInRefusal =
  | 'wrong code'
  | 'locked'
  | 'code expired'
  | 'account not live'
  | 'second step required'
  | 'wrong password'
  | 'password not set';

export type PasswordRefusal = 'not a committee member' | 'not allowed' | 'password too short' | 'password too long';

/** A fresh token and the person it names, so the sign-in's audit entry can name its subject; `registered` when the sign-in created the driver. */
export interface SignedIn {
  readonly token: string;
  readonly personId: PersonId;
  readonly registered: boolean;
}

/**
 * Sign-in by phone and one-time code (task A1). The code goes out through the SignInCodeSender port to any Egyptian
 * mobile number; a phone nobody registered becomes a driver the moment its code is confirmed, inside the sign-in's
 * unit of work (P3: no third public operation, F13). Staff are created only through createPerson. Members and the
 * Chair need a second step, their password (task A15): with the code alone they are answered "second step required"
 * and the code stays usable for the second step. Wrong codes are counted per phone; three lock the phone out, and a
 * locked phone is refused a new code until the lock-out ends (P23).
 */
export interface SignIn {
  requestSignInCode(phone: string): Promise<Result<void, 'locked'>>;
  signIn(transaction: TableAccess, phone: string, code: string): Promise<Result<SignedIn, SignInRefusal>>;
  signInWithSecondStep(transaction: TableAccess, phone: string, code: string, password: string): Promise<Result<SignedIn, SignInRefusal>>;
  setCommitteePassword(actor: PersonId, personId: PersonId, password: string): Promise<Result<void, PasswordRefusal>>;
}

/** Port: delivers a one-time code to a phone. Only an adapter names a messaging provider (Rule B). */
export interface SignInCodeSender {
  send(phone: string, code: string): Promise<void>;
}

/** The sign-in policy: code length and lifetime, wrong codes before a lock-out, and its length. */
export const SIGN_IN_POLICY: Readonly<Record<keyof typeof POLICY, number>> = POLICY;

/** The roles that need the second sign-in step, and the shortest and longest password accepted. */
export { COMMITTEE_ROLES, MAXIMUM_PASSWORD_BYTES, MINIMUM_PASSWORD_LENGTH } from './internal/domain/password';

/** The fake sender for tests and for development: it records every code instead of sending it. */
export class RecordingSignInCodeSender implements SignInCodeSender {
  private readonly sent: { readonly phone: string; readonly code: string }[] = [];

  async send(phone: string, code: string): Promise<void> {
    this.sent.push({ phone, code });
  }

  lastCodeSentTo(phone: string): string | undefined {
    return this.sent.filter((message) => message.phone === phone).at(-1)?.code;
  }

  count(): number {
    return this.sent.length;
  }
}

export interface AccountsAndAccessControlStores {
  readonly people: PeopleStore;
  readonly personalData: PersonalDataStore;
  readonly accessFacts: AccessFactsStore;
  readonly signInChallenges: SignInChallengeStore;
  readonly committeePasswords: CommitteePasswordStore;
}

export interface AccountsAndAccessControlDependencies {
  /** The committed tables (ADR-13): reads outside a request, and the writes that do not arrive with a unit of work yet. */
  readonly database: TableAccess;
  readonly stores: AccountsAndAccessControlStores;
  readonly siteLocator: SiteLocator;
  readonly carPresence: CarPresence;
  readonly signInCodeSender: SignInCodeSender;
  /** The entry point's token minter, handed in by the composition root (Q4, P27): sign-in never imports the entry point. */
  readonly tokenIssuer: TokenIssuer;
  /** The server secret that keys the stored hash of every sign-in code (P23). */
  readonly signInCodeSecret: string;
  readonly clock: Clock;
}

export interface AccountsAndAccessControl {
  readonly authorization: Authorization;
  readonly accessFacts: AccessFacts;
  readonly personalData: PersonalData;
  readonly signIn: SignIn;
  /** The one-time set-up of the first Chair, for the system operator only; no request reaches it. */
  bootstrapChair(phone: string, displayName: string): Promise<Result<PersonId, CreatePersonRefusal>>;
}

/** The composition root builds this module through this one function; nothing else constructs its internals. */
export function createAccountsAndAccessControl(dependencies: AccountsAndAccessControlDependencies): AccountsAndAccessControl {
  const { database, stores, siteLocator, carPresence, signInCodeSender, tokenIssuer, signInCodeSecret, clock } = dependencies;
  const authorization = new AuthorizationService({ database, people: stores.people, accessFacts: stores.accessFacts, siteLocator });
  const personalData = new PersonalDataService({
    database,
    people: stores.people,
    personalData: stores.personalData,
    signInChallenges: stores.signInChallenges,
    committeePasswords: stores.committeePasswords,
    accessFacts: stores.accessFacts,
    authorization,
    siteLocator,
    carPresence,
    clock,
  });
  const signIn = new SignInService({
    database,
    people: stores.people,
    personalData: stores.personalData,
    challenges: stores.signInChallenges,
    passwords: stores.committeePasswords,
    authorization,
    codeSender: signInCodeSender,
    tokenIssuer,
    codeHashSecret: signInCodeSecret,
    registerDriver: (transaction, phone) => personalData.registerDriverByPhone(transaction, phone),
    clock,
  });
  return {
    authorization,
    accessFacts: authorization,
    personalData,
    signIn,
    bootstrapChair: (phone, displayName) => personalData.bootstrapChair(phone, displayName),
  };
}

/** The stores over the shared TableAccess (ADR-13): the same adapters serve the in-memory database and PostgreSQL later. */
export function createAccountsStores(): AccountsAndAccessControlStores {
  return {
    people: new TablePeopleStore(),
    personalData: new TablePersonalDataStore(),
    accessFacts: new TableAccessFactsStore(),
    signInChallenges: new TableSignInChallengeStore(),
    committeePasswords: new TableCommitteePasswordStore(),
  };
}

/** The operations this module registers with the entry point; the composition root calls this once (P4). */
export { accountsOperations as operations, type AccountsOperationsDependencies } from './internal/operations';
