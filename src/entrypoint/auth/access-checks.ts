import type { Authorization, Scope } from '../../modules/accounts-and-access-control/public';

/**
 * The slice of Lino's Authorization the entry point depends on (P10, P26 Q4): the scope ladder for staff-scoped reads,
 * the live status checked on every request, and the site an attendant's session is bound to.
 */
export type AccessChecks = Pick<Authorization, 'may' | 'liveStatus' | 'boundSite'>;

/**
 * A stand-in that knows every person as active, bound to no site and inside every scope. The in-memory application
 * uses it unless told otherwise, so pipeline tests sign tokens for people no accounts module holds; the server
 * (`composeInMemoryServer`, `main.ts`) never does (see QUESTIONS.md).
 */
export const EVERYONE_IS_LIVE: AccessChecks = {
  may: async () => true,
  liveStatus: async () => 'active',
  boundSite: async () => undefined,
};

const SCOPE_QUERY_KEYS = ['siteId', 'zoneId', 'districtId'] as const;

/** The place a read is about, named in its query string; an empty scope is system-wide. */
export function scopeFromQuery(query: Readonly<Record<string, string>>): Scope {
  return Object.fromEntries(SCOPE_QUERY_KEYS.filter((key) => query[key] !== undefined).map((key) => [key, query[key]]));
}
