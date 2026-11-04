/**
 * Accounts & Access Control — owner: Teammate A (Area 2). Must-stay-on set.
 * Identities, roles, the hierarchy Chair > Member > Inspector > Attendant, session binding to a site, and the
 * personal-data store with logged joins and erasure (ADR-06 Rule F). Needs AuditTrail.
 */
import type { DistrictId, PersonId, Role, SiteId, ZoneId } from '../../shared/identifiers';
import type { Result } from '../../shared/result';

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

export type SignInRefusal = 'wrong code' | 'locked';

export interface PersonalData {
  createPerson(role: Role, phone: string, displayName: string): Promise<PersonId>;
  requestSignInCode(phone: string): Promise<void>;
  signIn(phone: string, code: string): Promise<Result<{ token: string }, SignInRefusal>>;
  addCar(driverId: PersonId, plate: string): Promise<void>;
  /** A logged join: every call writes a "plate read" audit entry naming the reader. */
  readPlate(driverRef: PersonId, reader: PersonId, purpose: string): Promise<Result<string, 'refused'>>;
  erase(personId: PersonId): Promise<void>;
}
