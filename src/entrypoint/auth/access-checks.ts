import type { Authorization, Scope } from '../../modules/accounts-and-access-control/public';

/**
 * The slice of Lino's Authorization the entry point depends on (P10, P26 Q4): the scope ladder for staff-scoped reads,
 * the live status checked on every request, and the site an attendant's session is bound to.
 */
export type AccessChecks = Pick<Authorization, 'may' | 'liveStatus' | 'boundSite'>;

const SCOPE_QUERY_KEYS = ['siteId', 'zoneId', 'districtId'] as const;

/** The place a read is about, named in its query string; an empty scope is system-wide. */
export function scopeFromQuery(query: Readonly<Record<string, string>>): Scope {
  return Object.fromEntries(SCOPE_QUERY_KEYS.filter((key) => query[key] !== undefined).map((key) => [key, query[key]]));
}
