import { beforeEach, describe, expect, it } from 'vitest';
import { composeInMemoryServer, type InMemoryApplication } from '../../../entrypoint/composition';
import type { HttpRequest } from '../../../entrypoint/http';
import { readRequest, TEST_ADDRESS, TEST_TOKEN_SECRET, tokenFor } from '../../../entrypoint/test-helpers';
import { FixedClock } from '../../../shared/clock';
import type { DistrictId, PersonId, Role } from '../../../shared/identifiers';
import { REQUEST_ID_HEADER } from '../../../shared/request-id';
import { looksLikeTimestampKey } from '../../../shared/timestamp-fields';
import type { AccountsAndAccessControl } from '../../accounts-and-access-control/public';
import type { SiteRegistry } from '../public';
import { squareAround, TEST_SITE_CODE_SECRET, TEST_START, valueOf } from './testing/registry-world';

/** The registry's requests through the composed in-memory server: token, role, request id, body, one audit entry per write. */
interface ComposedWorld {
  readonly clock: FixedClock;
  readonly accounts: AccountsAndAccessControl;
  readonly registry: SiteRegistry;
  readonly chair: PersonId;
}

let world: ComposedWorld;
let application: InMemoryApplication;
let districtOne: DistrictId;
let memberOfDistrictOne: PersonId;
let nextPhoneSuffix = 1;

async function createStaff(role: Exclude<Role, 'chair' | 'driver'>): Promise<PersonId> {
  const phone = `0110${String(nextPhoneSuffix++).padStart(7, '0')}`;
  return valueOf(await world.accounts.personalData.createPerson(world.chair, role, phone, `${role} ${phone}`));
}

let requestCounter = 0;

function post(path: string, personId: PersonId, role: Role, body: unknown, requestId = `request-${String(++requestCounter).padStart(4, '0')}`): HttpRequest {
  return {
    method: 'POST',
    path,
    query: {},
    headers: { authorization: `Bearer ${tokenFor(role, { personId })}`, [REQUEST_ID_HEADER]: requestId },
    address: TEST_ADDRESS,
    body,
  };
}

async function createSiteInDistrictOne(): Promise<string> {
  const zoneId = valueOf(await world.registry.createZone(world.chair, districtOne, 'Zamalek zone 1'));
  return valueOf(await world.registry.createSite(world.chair, zoneId, '26 July Street', squareAround(30.0626, 31.2197), 5));
}

beforeEach(async () => {
  const clock = new FixedClock(TEST_START);
  application = composeInMemoryServer({ tokenSecret: TEST_TOKEN_SECRET, siteCodeSecret: TEST_SITE_CODE_SECRET, clock });
  const { accounts, siteRegistry } = application.moduleDependencies;
  const chair = valueOf(await accounts.bootstrapChair('01000000000', 'The Chair'));
  world = { clock, accounts, registry: siteRegistry, chair };
  districtOne = valueOf(await world.registry.createDistrict(world.chair, 'Zamalek'));
  memberOfDistrictOne = await createStaff('member');
  await world.accounts.accessFacts.recordMemberDistrict(application.database, memberOfDistrictOne, districtOne);
});

describe('A6 through the entry point', () => {
  it('creates a zone and a site with an outline sent as a list of points (P6), each with one audit entry the district member can read', async () => {
    const zone = await application.handle(post('/zones', memberOfDistrictOne, 'member', { districtId: districtOne, label: 'Zamalek zone 1' }));
    expect(zone.status).toBe(201);
    const zoneId = (zone.body as { zoneId: string }).zoneId;
    const site = await application.handle(
      post('/sites', memberOfDistrictOne, 'member', { zoneId, label: '26 July Street', outline: squareAround(30.0626, 31.2197), capacity: 12 }),
    );
    expect(site.status).toBe(201);
    const entries = await application.audit.readByScope({ personId: memberOfDistrictOne, role: 'member', districtId: districtOne });
    expect(entries.map((entry) => entry.operation)).toEqual(['sites.createZone', 'sites.createSite']);
  });

  it('refuses an outline that is text or a list with a point out of range, before the module runs', async () => {
    const zoneId = valueOf(await world.registry.createZone(world.chair, districtOne, 'Zamalek zone 1'));
    const asText = await application.handle(post('/sites', world.chair, 'chair', { zoneId, label: 'Site', outline: '30.1,31.2;30.2,31.3;30.3,31.4', capacity: 5 }));
    const outOfRange = await application.handle(post('/sites', world.chair, 'chair', { zoneId, label: 'Site', outline: [{ latitude: 91, longitude: 0 }, ...squareAround(30, 31)], capacity: 5 }));
    expect([asText.status, outOfRange.status]).toEqual([400, 400]);
    expect(await application.audit.readByScope({ personId: world.chair, role: 'chair' })).toHaveLength(0);
  });

  it('refuses a member writing in another district with 403 and leaves no audit entry', async () => {
    const districtTwo = valueOf(await world.registry.createDistrict(world.chair, 'Dokki'));
    const response = await application.handle(post('/districts/label', memberOfDistrictOne, 'member', { districtId: districtTwo, label: 'Dokki West' }));
    expect(response).toEqual({ status: 403, body: { error: 'not allowed here' } });
    expect(await application.audit.readByScope({ personId: world.chair, role: 'chair' })).toHaveLength(0);
  });

  it('refuses a member creating a district through the permission table, before the module runs', async () => {
    const response = await application.handle(post('/districts', memberOfDistrictOne, 'member', { label: 'Garden City' }));
    expect(response.status).toBe(403);
  });

  it('gives the same answer to the same request id and creates the district once', async () => {
    const first = await application.handle(post('/districts', world.chair, 'chair', { label: 'Garden City' }, 'request-same-0001'));
    const second = await application.handle(post('/districts', world.chair, 'chair', { label: 'Garden City' }, 'request-same-0001'));
    expect(second).toEqual(first);
    expect(await application.audit.readByScope({ personId: world.chair, role: 'chair' })).toHaveLength(1);
  });

  it('refuses a member the capacity history of a site outside their district, through the pipeline\'s scope check (P10)', async () => {
    const districtTwo = valueOf(await world.registry.createDistrict(world.chair, 'Dokki'));
    const zoneTwo = valueOf(await world.registry.createZone(world.chair, districtTwo, 'Dokki zone 1'));
    const siteInDistrictTwo = valueOf(await world.registry.createSite(world.chair, zoneTwo, 'Tahrir Street', squareAround(30.0385, 31.2118), 8));
    const memberToken = tokenFor('member', { personId: memberOfDistrictOne });
    expect((await application.handle(readRequest('/sites/capacity-history', memberToken, { siteId: siteInDistrictTwo }))).status).toBe(403);
    const siteInDistrictOne = await createSiteInDistrictOne();
    expect((await application.handle(readRequest('/sites/capacity-history', memberToken, { siteId: siteInDistrictOne }))).status).toBe(200);
  });

  it('declares no timestamp field in any write body (fitness function F11 for this module)', () => {
    const fields = application.registry.writes().flatMap((operation) => Object.keys(operation.bodySchema.fields));
    expect(fields.filter(looksLikeTimestampKey)).toEqual([]);
  });

  it('changes capacity with the reason in the audit entry, and refuses a change without one', async () => {
    const siteId = await createSiteInDistrictOne();
    const withoutReason = await application.handle(post('/sites/capacity', memberOfDistrictOne, 'member', { siteId, capacity: 8, reason: ' ' }));
    expect(withoutReason).toEqual({ status: 400, body: { error: 'reason required' } });
    const changed = await application.handle(post('/sites/capacity', memberOfDistrictOne, 'member', { siteId, capacity: 8, reason: 'Two spaces repainted' }));
    expect(changed).toEqual({ status: 200, body: { siteId, capacity: 8 } });
    const entries = await application.audit.readByScope({ personId: memberOfDistrictOne, role: 'member', districtId: districtOne });
    expect(entries.map((entry) => [entry.operation, entry.reason])).toEqual([['sites.changeCapacity', 'Two spaces repainted']]);
  });

  it('answers the driver\'s map request with "unknown" band and no fee while ticketing and prices are not composed, and refuses a missing point', async () => {
    const siteId = await createSiteInDistrictOne();
    const driver = valueOf(await world.accounts.personalData.createPerson('self registration', 'driver', '01099999999', 'A Driver'));
    const token = tokenFor('driver', { personId: driver });
    const map = await application.handle(readRequest('/sites/nearby', token, { latitude: '30.0626', longitude: '31.2197', radius: '500' }));
    expect(map.status).toBe(200);
    expect((map.body as { sites: { siteId: string; band: string }[] }).sites).toMatchObject([{ siteId, band: 'unknown', firstHourFee: null }]);
    const missingPoint = await application.handle(readRequest('/sites/nearby', token, { radius: '500' }));
    expect(missingPoint).toEqual({ status: 400, body: { error: 'invalid point' } });
  });
});

describe('A9 through the entry point (P23 #12)', () => {
  const statusNow = (siteId: string) => application.handle(readRequest('/sites/status', tokenFor('chair', { personId: world.chair }), { siteId }));

  it('keeps a new site closed until the committee declares hours, and opens it around the clock on an explicit 00:00-24:00 row', async () => {
    const siteId = await createSiteInDistrictOne();
    expect(await statusNow(siteId)).toEqual({ status: 200, body: { open: false, free: false, reason: 'no opening hours declared' } });
    const declared = await application.handle(post('/sites/hours', memberOfDistrictOne, 'member', { siteId, hours: 'daily 00:00-24:00' }));
    expect(declared.status).toBe(200);
    expect(await statusNow(siteId)).toEqual({ status: 200, body: { open: true, free: false, reason: 'open' } });
    world.clock.advanceByMilliseconds(13 * 60 * 60 * 1000);
    expect((await statusNow(siteId)).body).toMatchObject({ open: true });
  });

  it('declares a closure with two calendar times (P6) and refuses the same closure sent as instants (Rule I)', async () => {
    const siteId = await createSiteInDistrictOne();
    await application.handle(post('/sites/hours', memberOfDistrictOne, 'member', { siteId, hours: 'daily 00:00-24:00' }));
    const closure = {
      siteId,
      kind: 'closure',
      from: { year: 2026, month: 11, day: 5, hour: 9, minute: 0 },
      until: { year: 2026, month: 11, day: 5, hour: 12, minute: 0 },
      reason: 'Road works',
    };
    const declared = await application.handle(post('/sites/special-events', memberOfDistrictOne, 'member', closure));
    expect(declared.status).toBe(201);
    expect(await statusNow(siteId)).toEqual({ status: 200, body: { open: false, free: false, reason: 'closed: Road works' } });
    const asInstants = await application.handle(post('/sites/special-events', memberOfDistrictOne, 'member', { ...closure, from: '2026-11-05T09:00:00Z', until: '2026-11-05T12:00:00Z' }));
    expect(asInstants.status).toBe(400);
    const entries = await application.audit.readByScope({ personId: memberOfDistrictOne, role: 'member', districtId: districtOne });
    expect(entries.map((entry) => [entry.operation, entry.reason])).toEqual([
      ['sites.setWeeklyHours', undefined],
      ['sites.declareSpecialEvent', 'Road works'],
    ]);
  });
});
