import type { PersonId } from '../../../shared/identifiers';
import type { AccountStatus, CarRef } from '../public';
import type { Person } from './domain/person';

/**
 * Storage ports owned by this module. The in-memory adapters in `adapters/` implement them for every test; the
 * PostgreSQL adapters will implement the same ports over the tables in `db/migrations/0002_identity_and_registry.sql`.
 */

/** The `accounts_and_access_control.people` table: references, roles and statuses only. */
export interface PeopleStore {
  add(person: Person): Promise<void>;
  find(personId: PersonId): Promise<Person | undefined>;
  setStatus(personId: PersonId, status: AccountStatus): Promise<void>;
  markErased(personId: PersonId): Promise<void>;
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

/** Rows removed from each personal-data table by one erasure (task A5). */
export interface ErasedRows {
  readonly personDetails: number;
  readonly cars: number;
}

/** The `personal_data` schema. Nothing outside this port stores a name, a phone or a plate (Rule F, F10). */
export interface PersonalDataStore {
  addDetails(details: PersonDetails): Promise<void>;
  detailsOf(personRef: PersonId): Promise<PersonDetails | undefined>;
  personWithPhone(phone: string): Promise<PersonId | undefined>;
  addCar(car: CarRecord): Promise<void>;
  car(carRef: CarRef): Promise<CarRecord | undefined>;
  carsOf(ownerRef: PersonId): Promise<readonly CarRecord[]>;
  eraseEverythingAbout(personRef: PersonId): Promise<ErasedRows>;
}
