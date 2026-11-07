import type { PersonId, SiteId } from '../../../../shared/identifiers';
import type { Row, TableAccess } from '../../../../shared/unit-of-work';
import type { AccountStatus, CarRef } from '../../public';
import type { PasswordHash } from '../domain/password';
import type { Person } from '../domain/person';
import type {
  AccessFactsRow,
  AccessFactsStore,
  CarRecord,
  CommitteePasswordStore,
  ErasedRows,
  PeopleStore,
  PersonalDataStore,
  PersonDetails,
  ResidencyRecord,
  SignInChallenge,
  SignInChallengeStore,
} from '../ports';

/**
 * This module's stores over the shared TableAccess (ADR-13): the same adapter serves the in-memory database of every
 * test and a PostgreSQL unit of work later. The table names are the ones of
 * `db/migrations/0002_identity_and_registry.sql`; names, phones and plates sit only in the `personal_data` tables.
 */
export const PEOPLE_TABLE = 'accounts_and_access_control.people';
export const ACCESS_FACTS_TABLE = 'accounts_and_access_control.access_facts';
export const COMMITTEE_PASSWORDS_TABLE = 'accounts_and_access_control.committee_passwords';
export const PERSON_DETAILS_TABLE = 'personal_data.person_details';
export const CARS_TABLE = 'personal_data.cars';
export const RESIDENCY_TABLE = 'personal_data.residency';
export const SIGN_IN_CHALLENGES_TABLE = 'personal_data.sign_in_challenges';

export class TablePeopleStore implements PeopleStore {
  async add(tables: TableAccess, person: Person): Promise<void> {
    await tables.insert(PEOPLE_TABLE, person.personId, person);
  }

  find(tables: TableAccess, personId: PersonId): Promise<Person | undefined> {
    return tables.read<Person>(PEOPLE_TABLE, personId);
  }

  async setStatus(tables: TableAccess, personId: PersonId, status: AccountStatus): Promise<void> {
    await tables.replace(PEOPLE_TABLE, personId, { ...(await this.existing(tables, personId)), status });
  }

  async markErased(tables: TableAccess, personId: PersonId): Promise<void> {
    await tables.replace(PEOPLE_TABLE, personId, { ...(await this.existing(tables, personId)), erased: true });
  }

  private async existing(tables: TableAccess, personId: PersonId): Promise<Person> {
    const person = await this.find(tables, personId);
    if (person === undefined) {
      throw new Error(`No person with the reference ${personId}`);
    }
    return person;
  }
}

export class TablePersonalDataStore implements PersonalDataStore {
  async addDetails(tables: TableAccess, details: PersonDetails): Promise<void> {
    await tables.insert(PERSON_DETAILS_TABLE, details.personRef, details);
  }

  detailsOf(tables: TableAccess, personRef: PersonId): Promise<PersonDetails | undefined> {
    return tables.read<PersonDetails>(PERSON_DETAILS_TABLE, personRef);
  }

  async personWithPhone(tables: TableAccess, phone: string): Promise<PersonId | undefined> {
    return (await tables.list<PersonDetails>(PERSON_DETAILS_TABLE)).find((details) => details.phone === phone)?.personRef;
  }

  async addCar(tables: TableAccess, car: CarRecord): Promise<void> {
    await tables.insert(CARS_TABLE, car.carRef, car);
  }

  car(tables: TableAccess, carRef: CarRef): Promise<CarRecord | undefined> {
    return tables.read<CarRecord>(CARS_TABLE, carRef);
  }

  async carsOf(tables: TableAccess, ownerRef: PersonId): Promise<readonly CarRecord[]> {
    return (await tables.list<CarRecord>(CARS_TABLE)).filter((car) => car.ownerRef === ownerRef);
  }

  async carWithPlate(tables: TableAccess, plate: string): Promise<CarRecord | undefined> {
    return (await tables.list<CarRecord>(CARS_TABLE)).find((car) => car.plate === plate);
  }

  async addResidency(tables: TableAccess, residency: ResidencyRecord): Promise<void> {
    await upsert(tables, RESIDENCY_TABLE, residencyKey(residency.carRef, residency.siteId), residency);
  }

  async isResident(tables: TableAccess, carRef: CarRef, siteId: SiteId): Promise<boolean> {
    return (await tables.read(RESIDENCY_TABLE, residencyKey(carRef, siteId))) !== undefined;
  }

  async eraseEverythingAbout(tables: TableAccess, personRef: PersonId): Promise<ErasedRows> {
    const personDetails = await removeIfPresent(tables, PERSON_DETAILS_TABLE, personRef);
    const ownedCars = await this.carsOf(tables, personRef);
    let residency = 0;
    for (const car of ownedCars) {
      residency += await removeMatching(tables, RESIDENCY_TABLE, (row: ResidencyRecord) => row.carRef === car.carRef, (row) => residencyKey(row.carRef, row.siteId));
      await tables.remove(CARS_TABLE, car.carRef);
    }
    return { personDetails, cars: ownedCars.length, residency };
  }
}

function residencyKey(carRef: CarRef, siteId: SiteId): string {
  return `${carRef}@${siteId}`;
}

export class TableAccessFactsStore implements AccessFactsStore {
  async factsOf(tables: TableAccess, personId: PersonId): Promise<AccessFactsRow> {
    return (await tables.read<AccessFactsRow>(ACCESS_FACTS_TABLE, personId)) ?? { personId };
  }

  async update(tables: TableAccess, personId: PersonId, change: (current: AccessFactsRow) => AccessFactsRow): Promise<void> {
    await upsert(tables, ACCESS_FACTS_TABLE, personId, change(await this.factsOf(tables, personId)));
  }

  remove(tables: TableAccess, personId: PersonId): Promise<number> {
    return removeIfPresent(tables, ACCESS_FACTS_TABLE, personId);
  }
}

export class TableSignInChallengeStore implements SignInChallengeStore {
  find(tables: TableAccess, phone: string): Promise<SignInChallenge | undefined> {
    return tables.read<SignInChallenge>(SIGN_IN_CHALLENGES_TABLE, phone);
  }

  async save(tables: TableAccess, challenge: SignInChallenge): Promise<void> {
    await upsert(tables, SIGN_IN_CHALLENGES_TABLE, challenge.phone, challenge);
  }

  remove(tables: TableAccess, phone: string): Promise<number> {
    return removeIfPresent(tables, SIGN_IN_CHALLENGES_TABLE, phone);
  }

  removeForPerson(tables: TableAccess, personId: PersonId): Promise<number> {
    return removeMatching(tables, SIGN_IN_CHALLENGES_TABLE, (row: SignInChallenge) => row.personId === personId, (row) => row.phone);
  }
}

interface StoredPassword extends PasswordHash {
  readonly personId: PersonId;
}

export class TableCommitteePasswordStore implements CommitteePasswordStore {
  async find(tables: TableAccess, personId: PersonId): Promise<PasswordHash | undefined> {
    const stored = await tables.read<StoredPassword>(COMMITTEE_PASSWORDS_TABLE, personId);
    return stored === undefined ? undefined : { salt: stored.salt, hash: stored.hash };
  }

  async save(tables: TableAccess, personId: PersonId, password: PasswordHash): Promise<void> {
    await upsert(tables, COMMITTEE_PASSWORDS_TABLE, personId, { personId, ...password });
  }

  remove(tables: TableAccess, personId: PersonId): Promise<number> {
    return removeIfPresent(tables, COMMITTEE_PASSWORDS_TABLE, personId);
  }
}

async function upsert(tables: TableAccess, table: string, key: string, row: Row): Promise<void> {
  if ((await tables.read(table, key)) === undefined) {
    await tables.insert(table, key, row);
  } else {
    await tables.replace(table, key, row);
  }
}

async function removeIfPresent(tables: TableAccess, table: string, key: string): Promise<number> {
  if ((await tables.read(table, key)) === undefined) {
    return 0;
  }
  await tables.remove(table, key);
  return 1;
}

async function removeMatching<Stored extends Row>(
  tables: TableAccess,
  table: string,
  matches: (row: Stored) => boolean,
  keyOf: (row: Stored) => string,
): Promise<number> {
  const matching = (await tables.list<Stored>(table)).filter(matches);
  for (const row of matching) {
    await tables.remove(table, keyOf(row));
  }
  return matching.length;
}
