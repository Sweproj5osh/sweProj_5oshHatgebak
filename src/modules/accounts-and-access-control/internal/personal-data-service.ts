import { randomUUID } from 'node:crypto';
import type { PersonId, Role } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import type { CreatePersonRefusal, PersonalData, PersonCreator } from '../public';
import { mayCreate, normaliseDisplayName, normalisePhone } from './domain/person';
import type { PeopleStore, PersonalDataStore } from './ports';

export interface PersonalDataDependencies {
  readonly people: PeopleStore;
  readonly personalData: PersonalDataStore;
}

/**
 * Creates people and keeps their personal data apart: the role and status go to the people table, the name and phone
 * go to the personal-data store, and both are joined only by the person reference (ADR-06, Rule F).
 */
export class PersonalDataService implements PersonalData {
  constructor(private readonly dependencies: PersonalDataDependencies) {}

  async createPerson(
    creator: PersonCreator,
    role: Role,
    phone: string,
    displayName: string,
  ): Promise<Result<PersonId, CreatePersonRefusal>> {
    const creatorRole = creator === 'self registration' ? undefined : (await this.dependencies.people.find(creator))?.role;
    const permitted = mayCreate(creator, creatorRole, role);
    if (!permitted.ok) {
      return permitted;
    }
    return this.register(role, phone, displayName);
  }

  /** The one-time set-up of the first Chair, run by the system operator, never reachable through a request. */
  async bootstrapChair(phone: string, displayName: string): Promise<Result<PersonId, CreatePersonRefusal>> {
    return this.register('chair', phone, displayName);
  }

  private async register(role: Role, phone: string, displayName: string): Promise<Result<PersonId, CreatePersonRefusal>> {
    const normalisedPhone = normalisePhone(phone);
    if (!normalisedPhone.ok) {
      return normalisedPhone;
    }
    const normalisedName = normaliseDisplayName(displayName);
    if (!normalisedName.ok) {
      return normalisedName;
    }
    if ((await this.dependencies.personalData.personWithPhone(normalisedPhone.value)) !== undefined) {
      return fail('phone already registered');
    }
    const personId = `person-${randomUUID()}`;
    await this.dependencies.people.add({ personId, role, status: 'active', erased: false });
    await this.dependencies.personalData.addDetails({
      personRef: personId,
      displayName: normalisedName.value,
      phone: normalisedPhone.value,
    });
    return succeed(personId);
  }
}
