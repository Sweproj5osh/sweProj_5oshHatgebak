/**
 * Accounts & Access Control — owner: Teammate A (Area 2). Must-stay-on set.
 * Identities, roles, the hierarchy Chair > Member > Inspector > Attendant, session binding to a site, and the
 * personal-data store with logged joins and erasure (ADR-06 Rule F). Needs AuditTrail.
 */
import type { DistrictId, PersonId, Role, SiteId, ZoneId } from '../../shared/identifiers';
import type { Result } from '../../shared/result';
import { InMemoryAccessFactsStore, InMemoryPeopleStore, InMemoryPersonalDataStore } from './internal/adapters/in-memory-stores';
import { AuthorizationService } from './internal/authorization-service';
import { SCOPE_RULES } from './internal/domain/scope-rules';
import { PersonalDataService } from './internal/personal-data-service';
import type { AccessFactsStore, PeopleStore, PersonalDataStore } from './internal/ports';

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
 * revoked a moment ago is refused on the very next call, with no new sign-in.
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
  bindSessionToSite(personId: PersonId, siteId: SiteId): Promise<Result<void, BindSessionRefusal>>;
  unbindSession(personId: PersonId): Promise<void>;
  boundSite(personId: PersonId): Promise<SiteId | undefined>;
}

/** The licence states as this module needs them; the licensing module owns the licences themselves. */
export type LicenceLiveState = 'valid' | 'suspended' | 'revoked';

/**
 * Written by the licensing module, inside the same transaction as its own change, so that this must-stay-on module
 * answers from its own table and never calls the may-fail licensing module (Rule D, fitness function F8).
 */
export interface AccessFacts {
  recordLicenceState(attendantId: PersonId, state: LicenceLiveState): Promise<void>;
  recordAttendantSite(attendantId: PersonId, siteId: SiteId): Promise<void>;
  recordInspectorZone(inspectorId: PersonId, zoneId: ZoneId): Promise<void>;
  recordMemberDistrict(memberId: PersonId, districtId: DistrictId): Promise<void>;
}

/**
 * Port: where a site or zone sits in the hierarchy. The composition root fills it from the site registry, so this
 * module and sites-and-areas never import each other in a circle.
 */
export interface SiteLocator {
  locateSite(siteId: SiteId): Promise<{ readonly zoneId: ZoneId } | undefined>;
  locateZone(zoneId: ZoneId): Promise<{ readonly districtId: DistrictId } | undefined>;
}

/** The scope rules in the order they are applied, for review and for the task A3 report. */
export const SCOPE_RULE_DESCRIPTIONS: readonly string[] = SCOPE_RULES.map((rule) => rule.description);

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
  readonly accessFacts: AccessFactsStore;
}

export interface AccountsAndAccessControlDependencies {
  readonly stores: AccountsAndAccessControlStores;
  readonly siteLocator: SiteLocator;
}

export interface AccountsAndAccessControl {
  readonly authorization: Authorization;
  readonly accessFacts: AccessFacts;
  readonly personalData: PersonalData;
  /** The one-time set-up of the first Chair, for the system operator only; no request reaches it. */
  bootstrapChair(phone: string, displayName: string): Promise<Result<PersonId, CreatePersonRefusal>>;
}

/** The composition root builds this module through this one function; nothing else constructs its internals. */
export function createAccountsAndAccessControl(dependencies: AccountsAndAccessControlDependencies): AccountsAndAccessControl {
  const { stores, siteLocator } = dependencies;
  const authorization = new AuthorizationService({ people: stores.people, accessFacts: stores.accessFacts, siteLocator });
  const personalData = new PersonalDataService(stores);
  return {
    authorization,
    accessFacts: authorization,
    personalData,
    bootstrapChair: (phone, displayName) => personalData.bootstrapChair(phone, displayName),
  };
}

export function createInMemoryAccountsStores(): AccountsAndAccessControlStores {
  return {
    people: new InMemoryPeopleStore(),
    personalData: new InMemoryPersonalDataStore(),
    accessFacts: new InMemoryAccessFactsStore(),
  };
}
