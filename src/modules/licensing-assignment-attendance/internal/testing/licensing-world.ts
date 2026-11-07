import { InMemoryDatabase } from '../../../../adapters/in-memory/in-memory-database';
import { FixedClock } from '../../../../shared/clock';
import type { DomainEvent, EventPublisher } from '../../../../shared/events/event';
import type { ApprovalRequestId, DistrictId, LicenceId, PersonId, Role, SiteId, ZoneId } from '../../../../shared/identifiers';
import type { Result } from '../../../../shared/result';
import type { TokenIssuer } from '../../../../shared/token-issuer';
import {
  createAccountsAndAccessControl,
  createAccountsStores,
  RecordingSignInCodeSender,
  type AccountsAndAccessControl,
  type CarPresence,
} from '../../../accounts-and-access-control/public';
import { createSiteLocator, createSiteRegistry, createSitesStores, type SiteRegistry } from '../../../sites-and-areas/public';
import {
  createLicensingAssignmentAttendance,
  createLicensingStores,
  type ApprovalUnitOfWork,
  type ApprovalVerifier,
  type LicenceState,
  type LicensingAssignmentAttendance,
  type LicensingAssignmentAttendanceStores,
} from '../../public';

/** A stand-in for Approvals: it confirms exactly the requests a test has marked approved, for exactly that move. */
export class FakeApprovals implements ApprovalVerifier {
  private readonly approved = new Map<ApprovalRequestId, { readonly licenceId: LicenceId; readonly to: LicenceState }>();

  approve(approvalRequestId: ApprovalRequestId, licenceId: LicenceId, to: LicenceState): void {
    this.approved.set(approvalRequestId, { licenceId, to });
  }

  async isApproved(approvalRequestId: ApprovalRequestId, change: { readonly licenceId: LicenceId; readonly to: LicenceState }): Promise<boolean> {
    const approvedChange = this.approved.get(approvalRequestId);
    return approvedChange?.licenceId === change.licenceId && approvedChange.to === change.to;
  }
}

/** Remembers what a module published, standing in for the outbox bound to the approving request's unit of work. */
export class RecordingEventPublisher implements EventPublisher {
  readonly published: DomainEvent[] = [];

  publish(event: DomainEvent): void {
    this.published.push(event);
  }
}

export const TEST_SITE_CODE_SECRET = 'site-code-secret-for-tests';

/** Nobody signs in through this world, so the token minter is a stand-in; this file never imports the entry point (F2). */
const NO_TOKENS_NEEDED: TokenIssuer = { issue: (identity) => `fake-token:${identity.personId}` };
const NO_PLATE_IS_READ_HERE: CarPresence = { carSeenAt: async () => false };

/**
 * Access control, the site registry and this module wired over one in-memory database the way the composition root
 * wires them, with two districts, each holding one zone and one site, and a member appointed to district one.
 */
export interface LicensingWorld {
  readonly clock: FixedClock;
  readonly database: InMemoryDatabase;
  readonly accounts: AccountsAndAccessControl;
  readonly registry: SiteRegistry;
  readonly licensing: LicensingAssignmentAttendance;
  readonly stores: LicensingAssignmentAttendanceStores;
  readonly approvals: FakeApprovals;
  readonly chair: PersonId;
  readonly memberOfDistrictOne: PersonId;
  readonly districtOne: DistrictId;
  readonly districtTwo: DistrictId;
  readonly zoneOne: ZoneId;
  readonly zoneTwo: ZoneId;
  readonly siteOne: SiteId;
  readonly siteOneBis: SiteId;
  readonly siteTwo: SiteId;
}

export async function createLicensingWorld(): Promise<LicensingWorld> {
  const clock = new FixedClock(new Date('2026-11-05T08:00:00Z'));
  const database = new InMemoryDatabase();
  const sitesStores = createSitesStores();
  const accounts = createAccountsAndAccessControl({
    database,
    stores: createAccountsStores(),
    siteLocator: createSiteLocator(database, sitesStores),
    carPresence: NO_PLATE_IS_READ_HERE,
    signInCodeSender: new RecordingSignInCodeSender(),
    tokenIssuer: NO_TOKENS_NEEDED,
    signInCodeSecret: 'sign-in-code-secret-for-tests',
    clock,
  });
  const registry = createSiteRegistry({
    database,
    stores: sitesStores,
    authorization: accounts.authorization,
    siteCodeSecret: TEST_SITE_CODE_SECRET,
    freeSpaces: { freeSpaces: async () => 0 },
    prices: { firstHourFee: async () => 0 },
    clock,
  });
  const stores = createLicensingStores();
  const approvals = new FakeApprovals();
  const licensing = createLicensingAssignmentAttendance({
    database,
    stores,
    authorization: accounts.authorization,
    accessFacts: accounts.accessFacts,
    registry,
    approvals,
    clock,
  });
  const chair = valueOf(await accounts.bootstrapChair('01000000000', 'The Chair'));
  const districtOne = valueOf(await registry.createDistrict(chair, 'Zamalek'));
  const districtTwo = valueOf(await registry.createDistrict(chair, 'Dokki'));
  const zoneOne = valueOf(await registry.createZone(chair, districtOne, 'Zamalek zone 1'));
  const zoneTwo = valueOf(await registry.createZone(chair, districtTwo, 'Dokki zone 1'));
  const siteOne = valueOf(await registry.createSite(chair, zoneOne, '26 July Street', squareAround(30.0626, 31.2197), 12));
  const siteOneBis = valueOf(await registry.createSite(chair, zoneOne, 'Brazil Street', squareAround(30.0650, 31.2210), 8));
  const siteTwo = valueOf(await registry.createSite(chair, zoneTwo, 'Tahrir Street', squareAround(30.0385, 31.2118), 20));
  const world = { clock, database, accounts, registry, licensing, stores, approvals, chair, districtOne, districtTwo, zoneOne, zoneTwo, siteOne, siteOneBis, siteTwo };
  const memberOfDistrictOne = await createPerson({ ...world, memberOfDistrictOne: chair }, 'member');
  valueOf(await licensing.assignments.appointMemberToDistrict(chair, memberOfDistrictOne, districtOne));
  return { ...world, memberOfDistrictOne };
}

/** A unit of work for an approved licence change in these tests: the world's own database and a recording publisher. */
export function approvalUnitOfWork(world: LicensingWorld): ApprovalUnitOfWork & { readonly events: RecordingEventPublisher } {
  return { transaction: world.database.begin(), events: new RecordingEventPublisher() };
}

let nextPhoneSuffix = 1;

/** Creates a staff member through the Chair, with a fresh phone number. */
export async function createPerson(world: LicensingWorld, role: Exclude<Role, 'chair' | 'driver'>): Promise<PersonId> {
  const phone = `0120${String(nextPhoneSuffix++).padStart(7, '0')}`;
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
