import type { DistrictId, PersonId, SiteId, ZoneId } from '../../../shared/identifiers';
import type { TableAccess } from '../../../shared/unit-of-work';
import type { AccountStatus, CarRef, LicenceLiveState } from '../public';
import type { PasswordHash } from './domain/password';
import type { Person } from './domain/person';

/**
 * Storage ports owned by this module. Every method takes the tables it works on (ADR-13): the committed tables for a
 * read outside a request, the request's unit of work for a write, so the same adapter serves both. The adapters in
 * `adapters/` work over any TableAccess, over the tables of `db/migrations/0002_identity_and_registry.sql`.
 */

/** The `accounts_and_access_control.people` table: references, roles and statuses only. */
export interface PeopleStore {
  add(tables: TableAccess, person: Person): Promise<void>;
  find(tables: TableAccess, personId: PersonId): Promise<Person | undefined>;
  setStatus(tables: TableAccess, personId: PersonId, status: AccountStatus): Promise<void>;
  markErased(tables: TableAccess, personId: PersonId): Promise<void>;
}

/** A person's name and phone, held only in the `personal_data` schema. */
export interface PersonDetails {
  readonly personRef: PersonId;
  readonly displayName: string;
  readonly phone: string;
}

/** A car and its plate, held only in the `personal_data` schema. */
export interface CarRecord {
  readonly carRef: CarRef;
  readonly ownerRef: PersonId;
  readonly plate: string;
}

/** "Car X is registered at site Y" (P28 #31, task A16): an address, so personal data, held only in `personal_data`. */
export interface ResidencyRecord {
  readonly carRef: CarRef;
  readonly siteId: SiteId;
  readonly registeredBy: PersonId;
  /** Set from the server clock (Rule I). */
  readonly registeredAt: string;
}

/** Rows removed from each personal-data table by one erasure (task A5). */
export interface ErasedRows {
  readonly personDetails: number;
  readonly cars: number;
  readonly residency: number;
}

/** The `personal_data` schema. Nothing outside this port stores a name, a phone or a plate (Rule F, F10). */
export interface PersonalDataStore {
  addDetails(tables: TableAccess, details: PersonDetails): Promise<void>;
  detailsOf(tables: TableAccess, personRef: PersonId): Promise<PersonDetails | undefined>;
  personWithPhone(tables: TableAccess, phone: string): Promise<PersonId | undefined>;
  addCar(tables: TableAccess, car: CarRecord): Promise<void>;
  car(tables: TableAccess, carRef: CarRef): Promise<CarRecord | undefined>;
  carsOf(tables: TableAccess, ownerRef: PersonId): Promise<readonly CarRecord[]>;
  /** The first car saved under this plate, whoever owns it; undefined when nobody saved it. */
  carWithPlate(tables: TableAccess, plate: string): Promise<CarRecord | undefined>;
  addResidency(tables: TableAccess, residency: ResidencyRecord): Promise<void>;
  isResident(tables: TableAccess, carRef: CarRef, siteId: SiteId): Promise<boolean>;
  eraseEverythingAbout(tables: TableAccess, personRef: PersonId): Promise<ErasedRows>;
}

/**
 * What this module knows about a person's licence and posts, recorded by the licensing module inside its own
 * transaction (Rule D: this must-stay-on module never calls the may-fail licensing module). Plus the site the
 * attendant's session is bound to at clock-in.
 */
export interface AccessFactsRow {
  readonly personId: PersonId;
  readonly licenceState?: LicenceLiveState;
  readonly attendantSiteId?: SiteId;
  readonly inspectorZoneId?: ZoneId;
  readonly memberDistrictId?: DistrictId;
  readonly boundSiteId?: SiteId;
}

/** The `accounts_and_access_control.access_facts` table: one row per person, replaced field by field. */
export interface AccessFactsStore {
  factsOf(tables: TableAccess, personId: PersonId): Promise<AccessFactsRow>;
  update(tables: TableAccess, personId: PersonId, change: (current: AccessFactsRow) => AccessFactsRow): Promise<void>;
  remove(tables: TableAccess, personId: PersonId): Promise<number>;
}

/**
 * The one outstanding one-time code for one phone (task A1), keyed by the phone so that the wrong-code count and the
 * lock-out survive a new code request (P23). Only a keyed hash of the code is kept. Times come from the server clock.
 */
export interface SignInChallenge {
  readonly phone: string;
  readonly personId: PersonId;
  readonly codeHash: string;
  readonly expiresAt: string;
  readonly failedAttempts: number;
  readonly lockedUntil?: string;
}

/** The `personal_data.sign_in_challenges` table (it is keyed by a phone, so it lives beside the other phones): one row per phone. */
export interface SignInChallengeStore {
  find(tables: TableAccess, phone: string): Promise<SignInChallenge | undefined>;
  save(tables: TableAccess, challenge: SignInChallenge): Promise<void>;
  remove(tables: TableAccess, phone: string): Promise<number>;
  removeForPerson(tables: TableAccess, personId: PersonId): Promise<number>;
}

/** The `accounts_and_access_control.committee_passwords` table: a salted scrypt hash per member or Chair. */
export interface CommitteePasswordStore {
  find(tables: TableAccess, personId: PersonId): Promise<PasswordHash | undefined>;
  save(tables: TableAccess, personId: PersonId, password: PasswordHash): Promise<void>;
  remove(tables: TableAccess, personId: PersonId): Promise<number>;
}
