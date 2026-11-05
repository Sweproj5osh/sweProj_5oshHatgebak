import type { DistrictId, Role, SiteId, ZoneId } from '../../../../shared/identifiers';
import type { AccountStatus } from '../../public';

/**
 * The scope rules of task A3, as one ordered list: the first rule that has a verdict decides. Pure: no storage, no
 * clock, so every rule is tested with plain values. Hierarchy: Chair > Member (district) > Inspector (zone) >
 * Attendant (site).
 */

/** The place a request is about, with the zone and district filled in from the site registry. */
export interface ResolvedScope {
  readonly siteId?: SiteId;
  readonly zoneId?: ZoneId;
  readonly districtId?: DistrictId;
  /** True when the request named a site or zone the registry does not know, or ids that do not belong together. */
  readonly unresolvable: boolean;
}

/** Everything known about the person asking, read fresh on every request. */
export interface Asker {
  readonly role: Role;
  readonly liveStatus: AccountStatus;
  readonly memberDistrictId?: DistrictId;
  readonly inspectorZoneId?: ZoneId;
  readonly attendantSiteId?: SiteId;
}

export interface ScopeRule {
  readonly description: string;
  verdict(asker: Asker, scope: ResolvedScope): Verdict | undefined;
}

export interface Verdict {
  readonly allowed: boolean;
  readonly reason: string;
}

const allow = (reason: string): Verdict => ({ allowed: true, reason });
const deny = (reason: string): Verdict => ({ allowed: false, reason });

export const SCOPE_RULES: readonly ScopeRule[] = [
  {
    description: 'a suspended or revoked account, or an attendant whose licence is not valid, may do nothing',
    verdict: (asker) => (asker.liveStatus === 'active' ? undefined : deny(`account is ${asker.liveStatus}`)),
  },
  {
    description: 'a request about a place the registry does not know is refused',
    verdict: (_asker, scope) => (scope.unresolvable ? deny('unknown or inconsistent place') : undefined),
  },
  {
    description: 'the Chair may act everywhere',
    verdict: (asker) => (asker.role === 'chair' ? allow('the Chair acts everywhere') : undefined),
  },
  {
    description: 'a request about no particular place is system-wide, and only the Chair acts system-wide',
    verdict: (_asker, scope) => (isSystemWide(scope) ? deny('only the Chair acts system-wide') : undefined),
  },
  {
    description: 'a member may act only inside their own district',
    verdict: (asker, scope) =>
      asker.role !== 'member' ? undefined : decide(asker.memberDistrictId, scope.districtId, 'district'),
  },
  {
    description: 'an inspector may act only inside their own zone',
    verdict: (asker, scope) => (asker.role !== 'inspector' ? undefined : decide(asker.inspectorZoneId, scope.zoneId, 'zone')),
  },
  {
    description: 'an attendant may act only at their one assigned site',
    verdict: (asker, scope) => (asker.role !== 'attendant' ? undefined : decide(asker.attendantSiteId, scope.siteId, 'site')),
  },
  {
    description: 'a driver has no scope over places; the module that owns a record checks that it is the driver\'s own',
    verdict: () => deny('drivers act only on their own records'),
  },
];

export function decideScope(asker: Asker, scope: ResolvedScope): Verdict {
  for (const rule of SCOPE_RULES) {
    const verdict = rule.verdict(asker, scope);
    if (verdict !== undefined) {
      return verdict;
    }
  }
  return deny('no rule allows this');
}

function isSystemWide(scope: ResolvedScope): boolean {
  return scope.siteId === undefined && scope.zoneId === undefined && scope.districtId === undefined;
}

function decide(own: string | undefined, requested: string | undefined, level: string): Verdict {
  if (own === undefined) {
    return deny(`no ${level} assigned`);
  }
  if (requested === undefined) {
    return deny(`the request is wider than one ${level}`);
  }
  return own === requested ? allow(`inside own ${level}`) : deny(`outside own ${level}`);
}
