/**
 * Accounts & Access Control — owner: Teammate A (Area 2). Must-stay-on set.
 * Identities, roles, the hierarchy Chair > Member > Inspector > Attendant, session binding to a site, and the
 * personal-data store with logged joins and erasure (ADR-06 Rule F). Needs AuditTrail.
 */
import type { DistrictId, PersonId, Role, SiteId, ZoneId } from '../../shared/identifiers';
import type { Result } from '../../shared/result';
import { InMemoryPeopleStore, InMemoryPersonalDataStore } from './internal/adapters/in-memory-stores';
import { PersonalDataService } from './internal/personal-data-service';
import type { PeopleStore, PersonalDataStore } from './internal/ports';

export interface Scope {
  readonly siteId?: SiteId;
  readonly zoneId?: ZoneId;
  readonly districtId?: DistrictId;
}

export type AccountStatus = 'active' | 'suspended' | 'revoked';

export interface Authorization {
  may(personId: PersonId, operation: string, scope: Scope): Promise<boolean>;
  liveStatus(personId: PersonId): Promise<AccountStatus>;
  bindSessionToSite(personId: PersonId, siteId: SiteId): Promise<void>;
  boundSite(personId: PersonId): Promise<SiteId | undefined>;
}

/** The reference of one car in the personal-data store. Other modules hold this, never the plate. */
export type CarRef = string;

/** Who is creating a person: a driver registering themself, or the staff member doing it. */
export type PersonCreator = 'self registration' | PersonId;

export type CreatePersonRefusal = 'not allowed to create this role' | 'invalid phone' | 'invalid name' | 'phone already registered';

export interface PersonalData {
  createPerson(creator: PersonCreator, role: Role, phone: string, displayName: string): Promise<Result<PersonId, CreatePersonRefusal>>;
}

export interface AccountsAndAccessControlStores {
  readonly people: PeopleStore;
  readonly personalData: PersonalDataStore;
}

export interface AccountsAndAccessControl {
  readonly personalData: PersonalData;
  /** The one-time set-up of the first Chair, for the system operator only; no request reaches it. */
  bootstrapChair(phone: string, displayName: string): Promise<Result<PersonId, CreatePersonRefusal>>;
}

/** The composition root builds this module through this one function; nothing else constructs its internals. */
export function createAccountsAndAccessControl(stores: AccountsAndAccessControlStores): AccountsAndAccessControl {
  const personalData = new PersonalDataService(stores);
  return {
    personalData,
    bootstrapChair: (phone, displayName) => personalData.bootstrapChair(phone, displayName),
  };
}

export function createInMemoryAccountsStores(): AccountsAndAccessControlStores {
  return { people: new InMemoryPeopleStore(), personalData: new InMemoryPersonalDataStore() };
}
