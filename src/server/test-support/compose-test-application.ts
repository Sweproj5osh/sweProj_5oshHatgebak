import type { CarPresence } from '../modules/identity-and-registry/accounts-and-access-control/index';
import type { AccessChecks } from '../http/auth/access-checks';
import { compose, type InMemoryApplication, type InMemoryApplicationOptions, type TicketingPorts } from '../composition/compose-server';
import { fail, succeed } from '../shared/result';

export type { InMemoryApplication, InMemoryApplicationOptions } from '../composition/compose-server';

/**
 * Test-only (F14): the in-memory application the tests compose, and every stand-in it uses in place of the real
 * modules' answers. Nothing outside tests, test worlds and the demo scripts may import this file.
 */

/**
 * A stand-in that knows every person as active, bound to no site and inside every scope. The in-memory application
 * uses it unless told otherwise, so pipeline tests sign tokens for people no accounts module holds; the server
 * (`composeInMemoryServer`, `main.ts`) never does (see docs/team/QUESTIONS.md).
 */
export const EVERYONE_IS_LIVE: AccessChecks = {
  may: async () => true,
  liveStatus: async () => 'active',
  boundSite: async () => undefined,
};

/** The in-memory application for tests: stand-ins answer live status and ticketing's ports unless the test passes its own. */
export function composeInMemoryApplication(options: InMemoryApplicationOptions): InMemoryApplication {
  return compose(options, {
    chooseAccessChecks: () => options.accessChecks ?? EVERYONE_IS_LIVE_AND_CLOCKED_IN,
    chooseTicketingPorts: () => TICKETING_PORTS_FOR_TESTS,
    chooseCarPresence: () => EVERY_CAR_IS_PRESENT,
  });
}

/** The test application's car presence: every car was seen everywhere, so the sample requests of the F5 harness run (docs/team/QUESTIONS.md item 21). */
const EVERY_CAR_IS_PRESENT: CarPresence = { carSeenAt: async () => true };

/** The spaces every site has in the in-memory test application. */
const STAND_IN_CAPACITY = 5;

/** The site every attendant's session is bound to in the in-memory test application, so assisted sample requests run. */
const STAND_IN_BOUND_SITE = 'site-1';

/**
 * What the in-memory test application answers instead, so that the audit-coverage harness (F5) can run the modules'
 * sample requests (the EVERYONE_IS_LIVE precedent, docs/team/QUESTIONS.md item 21): a code `entry-<site>` or `exit-<site>` is
 * genuine for that site, every site is open with STAND_IN_CAPACITY spaces, every car belongs to whoever asks, no plate
 * resolves, every approval request counts as approved. A test that needs other answers passes `moduleDependencies`.
 */
const TICKETING_PORTS_FOR_TESTS: TicketingPorts = {
  sites: {
    verifyEntryCode: async (code, siteId) => (code === `entry-${siteId}` ? succeed(siteId) : fail('forged')),
    verifyExitCode: async (code, siteId) => (code === `exit-${siteId}` ? succeed(siteId) : fail('forged')),
    isOpenAt: async () => true,
    capacityOf: async () => STAND_IN_CAPACITY,
  },
  carOwnership: { carBelongsTo: async () => true },
  plates: { readPlate: async () => fail('not resolvable') },
  isApproved: () => true,
};

/** EVERYONE_IS_LIVE with every session bound to STAND_IN_BOUND_SITE, the test application's default access checks. */
const EVERYONE_IS_LIVE_AND_CLOCKED_IN: AccessChecks = { ...EVERYONE_IS_LIVE, boundSite: async () => STAND_IN_BOUND_SITE };
