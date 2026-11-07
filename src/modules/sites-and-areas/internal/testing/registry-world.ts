import {
  createAccountsAndAccessControl,
  createInMemoryAccountsStores,
  RecordingSignInCodeSender,
  type AccountsAndAccessControl,
} from '../../../accounts-and-access-control/public';
import { FixedClock } from '../../../../shared/clock';
import type { PersonId, Role, SiteId } from '../../../../shared/identifiers';
import type { Result } from '../../../../shared/result';
import type { TokenIssuer } from '../../../../shared/token-issuer';
import {
  createInMemorySitesStores,
  createSiteLocator,
  createSiteRegistry,
  type SiteRegistry,
  type SitesAndAreasStores,
} from '../../public';

export const TEST_SITE_CODE_SECRET = 'site-code-secret-for-tests';
export const TEST_START = new Date('2026-11-05T08:00:00Z');

/** Nobody signs in through this world, so the token minter is a stand-in; this file never imports the entry point (F2). */
const NO_TOKENS_NEEDED: TokenIssuer = { issue: (identity) => `fake-token:${identity.personId}` };

/** Access control and the site registry wired together over in-memory stores, the way the composition root wires them. */
export interface RegistryWorld {
  readonly clock: FixedClock;
  readonly accounts: AccountsAndAccessControl;
  readonly sitesStores: SitesAndAreasStores;
  readonly registry: SiteRegistry;
  readonly chair: PersonId;
  /** Free spaces per site, as ticketing would count them; a site missing here makes the source fail. */
  readonly freeSpaceCounts: Map<SiteId, number>;
  /** First-hour fees per site, as the committee's price list would give them; a missing site makes the source fail. */
  readonly firstHourFees: Map<SiteId, number>;
}

export async function createRegistryWorld(): Promise<RegistryWorld> {
  const clock = new FixedClock(TEST_START);
  const sitesStores = createInMemorySitesStores();
  const accounts = createAccountsAndAccessControl({
    stores: createInMemoryAccountsStores(),
    siteLocator: createSiteLocator(sitesStores),
    signInCodeSender: new RecordingSignInCodeSender(),
    tokenIssuer: NO_TOKENS_NEEDED,
    clock,
  });
  const freeSpaceCounts = new Map<SiteId, number>();
  const firstHourFees = new Map<SiteId, number>();
  const registry = createSiteRegistry({
    stores: sitesStores,
    authorization: accounts.authorization,
    siteCodeSecret: TEST_SITE_CODE_SECRET,
    freeSpaces: { freeSpaces: async (siteId) => known(freeSpaceCounts, siteId, 'free-space count') },
    prices: { firstHourFee: async (siteId) => known(firstHourFees, siteId, 'price') },
    clock,
  });
  const chair = valueOf(await accounts.bootstrapChair('01000000000', 'The Chair'));
  return { clock, accounts, sitesStores, registry, chair, freeSpaceCounts, firstHourFees };
}

let nextPhoneSuffix = 1;

/** Creates a staff member through the Chair, as the hierarchy allows, with a fresh phone number. */
export async function createStaff(world: RegistryWorld, role: Exclude<Role, 'chair' | 'driver'>): Promise<PersonId> {
  const phone = `0110${String(nextPhoneSuffix++).padStart(7, '0')}`;
  return valueOf(await world.accounts.personalData.createPerson(world.chair, role, phone, `${role} ${phone}`));
}

/** A small square around a point, about 40 metres on each side. */
export function squareAround(latitude: number, longitude: number) {
  const half = 0.0002;
  return [
    { latitude: latitude - half, longitude: longitude - half },
    { latitude: latitude - half, longitude: longitude + half },
    { latitude: latitude + half, longitude: longitude + half },
    { latitude: latitude + half, longitude: longitude - half },
  ];
}

export function valueOf<Value>(result: Result<Value, string>): Value {
  if (!result.ok) {
    throw new Error(`test set-up was refused: ${result.error}`);
  }
  return result.value;
}

function known(values: ReadonlyMap<SiteId, number>, siteId: SiteId, what: string): number {
  const value = values.get(siteId);
  if (value === undefined) {
    throw new Error(`no ${what} for ${siteId} in this test`);
  }
  return value;
}
