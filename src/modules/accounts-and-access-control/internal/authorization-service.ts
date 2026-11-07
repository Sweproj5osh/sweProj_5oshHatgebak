import type { DistrictId, PersonId, Role, SiteId, ZoneId } from '../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../shared/result';
import type { TableAccess } from '../../../shared/unit-of-work';
import type {
  AccessDecision,
  AccessFacts,
  AccountStatus,
  Authorization,
  BindSessionRefusal,
  LicenceLiveState,
  Scope,
  SiteLocator,
} from '../public';
import type { Person } from './domain/person';
import { decideScope, type ResolvedScope } from './domain/scope-rules';
import type { AccessFactsRow, AccessFactsStore, PeopleStore } from './ports';

export interface AuthorizationDependencies {
  /** The committed tables, for the reads the entry point and the modules make outside any unit of work. */
  readonly database: TableAccess;
  readonly people: PeopleStore;
  readonly accessFacts: AccessFactsStore;
  readonly siteLocator: SiteLocator;
}

/**
 * Answers "may this person do this operation on this place?" from facts read fresh on every call, so a licence revoked
 * a moment ago is refused on the very next request without a new sign-in (task A3, ADR-10). The facts are written by
 * the licensing module through the AccessFacts side, inside the writer's unit of work (ADR-13).
 */
export class AuthorizationService implements Authorization, AccessFacts {
  constructor(private readonly dependencies: AuthorizationDependencies) {}

  async may(personId: PersonId, operation: string, scope: Scope): Promise<boolean> {
    return (await this.explain(personId, operation, scope)).allowed;
  }

  async explain(personId: PersonId, operation: string, scope: Scope): Promise<AccessDecision> {
    const person = await this.dependencies.people.find(this.database, personId);
    if (person === undefined) {
      return { operation, allowed: false, reason: 'unknown person' };
    }
    const facts = await this.dependencies.accessFacts.factsOf(this.database, personId);
    const verdict = decideScope(
      { role: person.role, liveStatus: liveStatusOf(person, facts), ...postsOf(facts) },
      await this.resolve(scope),
    );
    return { operation, ...verdict };
  }

  async liveStatus(personId: PersonId): Promise<AccountStatus> {
    const person = await this.dependencies.people.find(this.database, personId);
    if (person === undefined) {
      return 'revoked';
    }
    return liveStatusOf(person, await this.dependencies.accessFacts.factsOf(this.database, personId));
  }

  async roleOf(personId: PersonId): Promise<Role | undefined> {
    return (await this.dependencies.people.find(this.database, personId))?.role;
  }

  async memberDistrictOf(personId: PersonId): Promise<DistrictId | undefined> {
    return (await this.dependencies.accessFacts.factsOf(this.database, personId)).memberDistrictId;
  }

  async bindSessionToSite(transaction: TableAccess, personId: PersonId, siteId: SiteId): Promise<Result<void, BindSessionRefusal>> {
    const person = await this.dependencies.people.find(transaction, personId);
    if (person?.role !== 'attendant') {
      return fail('only an attendant clocks in');
    }
    const facts = await this.dependencies.accessFacts.factsOf(transaction, personId);
    if (liveStatusOf(person, facts) !== 'active') {
      return fail('account or licence not live');
    }
    if (facts.attendantSiteId !== siteId) {
      return fail('not assigned to this site');
    }
    await this.dependencies.accessFacts.update(transaction, personId, (current) => ({ ...current, boundSiteId: siteId }));
    return succeed(undefined);
  }

  async unbindSession(transaction: TableAccess, personId: PersonId): Promise<void> {
    await this.dependencies.accessFacts.update(transaction, personId, withoutBoundSite);
  }

  async boundSite(personId: PersonId): Promise<SiteId | undefined> {
    return (await this.dependencies.accessFacts.factsOf(this.database, personId)).boundSiteId;
  }

  async recordLicenceState(transaction: TableAccess, attendantId: PersonId, state: LicenceLiveState): Promise<void> {
    await this.dependencies.accessFacts.update(transaction, attendantId, (current) => {
      const updated = { ...current, licenceState: state };
      return state === 'valid' ? updated : withoutBoundSite(updated);
    });
  }

  async recordAttendantSite(transaction: TableAccess, attendantId: PersonId, siteId: SiteId): Promise<void> {
    await this.dependencies.accessFacts.update(transaction, attendantId, (current) => ({ ...withoutBoundSite(current), attendantSiteId: siteId }));
  }

  async clearAttendantSite(transaction: TableAccess, attendantId: PersonId): Promise<void> {
    await this.dependencies.accessFacts.update(transaction, attendantId, (current) => {
      const { attendantSiteId: _released, ...rest } = withoutBoundSite(current);
      return rest;
    });
  }

  async recordInspectorZone(transaction: TableAccess, inspectorId: PersonId, zoneId: ZoneId): Promise<void> {
    await this.dependencies.accessFacts.update(transaction, inspectorId, (current) => ({ ...current, inspectorZoneId: zoneId }));
  }

  async recordMemberDistrict(transaction: TableAccess, memberId: PersonId, districtId: DistrictId): Promise<void> {
    await this.dependencies.accessFacts.update(transaction, memberId, (current) => ({ ...current, memberDistrictId: districtId }));
  }

  private get database(): TableAccess {
    return this.dependencies.database;
  }

  /** Fills in the zone and district of a named site or zone, and catches ids that do not belong together. */
  private async resolve(scope: Scope): Promise<ResolvedScope> {
    let { siteId, zoneId, districtId } = scope;
    if (siteId !== undefined) {
      const site = await this.dependencies.siteLocator.locateSite(siteId);
      if (site === undefined || (zoneId !== undefined && zoneId !== site.zoneId)) {
        return { unresolvable: true };
      }
      zoneId = site.zoneId;
    }
    if (zoneId !== undefined) {
      const zone = await this.dependencies.siteLocator.locateZone(zoneId);
      if (zone === undefined || (districtId !== undefined && districtId !== zone.districtId)) {
        return { unresolvable: true };
      }
      districtId = zone.districtId;
    }
    return { ...optional({ siteId, zoneId, districtId }), unresolvable: false };
  }
}

/**
 * The account status, combined with the licence for an attendant: an attendant without a valid licence is not live.
 * An erased person is never live again.
 */
function liveStatusOf(person: Person, facts: AccessFactsRow): AccountStatus {
  if (person.erased) {
    return 'revoked';
  }
  if (person.status !== 'active' || person.role !== 'attendant') {
    return person.status;
  }
  switch (facts.licenceState) {
    case 'valid':
      return 'active';
    case 'revoked':
      return 'revoked';
    default:
      return 'suspended';
  }
}

function postsOf(facts: AccessFactsRow): { memberDistrictId?: DistrictId; inspectorZoneId?: ZoneId; attendantSiteId?: SiteId } {
  return optional({
    memberDistrictId: facts.memberDistrictId,
    inspectorZoneId: facts.inspectorZoneId,
    attendantSiteId: facts.attendantSiteId,
  });
}

function withoutBoundSite(facts: AccessFactsRow): AccessFactsRow {
  const { boundSiteId: _droppedBinding, ...rest } = facts;
  return rest;
}

/** Drops the keys whose value is undefined, as exact optional property types require. */
function optional<Fields extends Record<string, string | undefined>>(fields: Fields): { [Key in keyof Fields]?: string } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [Key in keyof Fields]?: string };
}
