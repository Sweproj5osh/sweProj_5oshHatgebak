import { beforeEach, describe, expect, it } from 'vitest';
import { composeInMemoryServer, type InMemoryApplication } from '../../../entrypoint/composition';
import type { HttpRequest } from '../../../entrypoint/http';
import { readRequest, TEST_ADDRESS, TEST_TOKEN_SECRET, tokenFor } from '../../../entrypoint/test-helpers';
import type { DistrictId, PersonId, Role, SiteId } from '../../../shared/identifiers';
import { REQUEST_ID_HEADER } from '../../../shared/request-id';
import type { AccountsAndAccessControl } from '../../accounts-and-access-control/public';
import type { SiteRegistry } from '../../sites-and-areas/public';
import { createLicensingStores, type LicensingAssignmentAttendance, type LicensingAssignmentAttendanceStores } from '../public';
import { squareAround, TEST_SITE_CODE_SECRET, valueOf } from './testing/licensing-world';

/** This module's requests through the composed in-memory server: one audit entry per success, naming the person concerned; none per reading. */
interface ComposedWorld {
  readonly accounts: AccountsAndAccessControl;
  readonly registry: SiteRegistry;
  readonly licensing: LicensingAssignmentAttendance;
  readonly stores: LicensingAssignmentAttendanceStores;
  readonly chair: PersonId;
  readonly memberOfDistrictOne: PersonId;
  readonly districtOne: DistrictId;
  readonly siteOne: SiteId;
  readonly siteTwo: SiteId;
}

let world: ComposedWorld;
let application: InMemoryApplication;
let requestCounter = 0;
let nextPhoneSuffix = 1;

async function createPerson(role: Exclude<Role, 'chair' | 'driver'>): Promise<PersonId> {
  const phone = `0120${String(nextPhoneSuffix++).padStart(7, '0')}`;
  return valueOf(await world.accounts.personalData.createPerson(world.chair, role, phone, `${role} ${phone}`));
}

async function composedWorld(): Promise<ComposedWorld> {
  const { accounts, siteRegistry, licensing } = application.moduleDependencies;
  const chair = valueOf(await accounts.bootstrapChair('01000000000', 'The Chair'));
  const districtOne = valueOf(await siteRegistry.createDistrict(chair, 'Zamalek'));
  const districtTwo = valueOf(await siteRegistry.createDistrict(chair, 'Dokki'));
  const zoneOne = valueOf(await siteRegistry.createZone(chair, districtOne, 'Zamalek zone 1'));
  const zoneTwo = valueOf(await siteRegistry.createZone(chair, districtTwo, 'Dokki zone 1'));
  const siteOne = valueOf(await siteRegistry.createSite(chair, zoneOne, '26 July Street', squareAround(30.0626, 31.2197), 12));
  const siteTwo = valueOf(await siteRegistry.createSite(chair, zoneTwo, 'Tahrir Street', squareAround(30.0385, 31.2118), 20));
  const memberOfDistrictOne = valueOf(await accounts.personalData.createPerson(chair, 'member', '01020000000', 'A Member'));
  valueOf(await licensing.assignments.appointMemberToDistrict(chair, memberOfDistrictOne, districtOne));
  return { accounts, registry: siteRegistry, licensing, stores: createLicensingStores(), chair, memberOfDistrictOne, districtOne, siteOne, siteTwo };
}

function post(path: string, personId: PersonId, role: Role, body: unknown): HttpRequest {
  return {
    method: 'POST',
    path,
    query: {},
    headers: {
      authorization: `Bearer ${tokenFor(role, { personId })}`,
      [REQUEST_ID_HEADER]: `request-${String(++requestCounter).padStart(4, '0')}`,
    },
    address: TEST_ADDRESS,
    body,
  };
}

/** A telemetry post (P7): token and body, no request id. */
function reading(personId: PersonId, latitude: number, longitude: number): HttpRequest {
  return { method: 'POST', path: '/attendance/location-readings', query: {}, headers: { authorization: `Bearer ${tokenFor('attendant', { personId })}` }, address: TEST_ADDRESS, body: { latitude, longitude } };
}

async function licensedAttendantAtSiteOne(): Promise<PersonId> {
  const attendant = await createPerson('attendant');
  valueOf(await world.licensing.assignments.assignAttendantToSite(world.chair, attendant, world.siteOne, 'morning'));
  valueOf(await world.licensing.licences.issueLicence(world.chair, attendant));
  return attendant;
}

beforeEach(async () => {
  application = composeInMemoryServer({ tokenSecret: TEST_TOKEN_SECRET, siteCodeSecret: TEST_SITE_CODE_SECRET });
  world = await composedWorld();
});

describe('A12 through the entry point', () => {
  it('assigns an attendant with one audit entry the attendant and the district member can both read', async () => {
    const attendant = await createPerson('attendant');
    const response = await application.handle(
      post('/assignments/attendants', world.memberOfDistrictOne, 'member', { attendantId: attendant, siteId: world.siteOne, shiftId: 'morning' }),
    );
    expect(response.status).toBe(200);
    const asAttendant = await application.audit.readByScope({ personId: attendant, role: 'attendant' });
    const asMember = await application.audit.readByScope({ personId: world.memberOfDistrictOne, role: 'member', districtId: world.districtOne });
    expect(asAttendant.map((entry) => entry.operation)).toEqual(['assignments.assignAttendant']);
    expect(asMember).toEqual(asAttendant);
  });

  it('answers a second site with 409 "one site per attendant" and no audit entry', async () => {
    const attendant = await createPerson('attendant');
    await application.handle(post('/assignments/attendants', world.chair, 'chair', { attendantId: attendant, siteId: world.siteOne, shiftId: 'morning' }));
    const second = await application.handle(post('/assignments/attendants', world.chair, 'chair', { attendantId: attendant, siteId: world.siteTwo, shiftId: 'morning' }));
    expect(second).toEqual({ status: 409, body: { error: 'one site per attendant' } });
    expect(await application.audit.readByScope({ personId: world.chair, role: 'chair' })).toHaveLength(1);
  });

  it('keeps member appointments to the Chair in the permission table itself', async () => {
    const member = await createPerson('member');
    const response = await application.handle(post('/assignments/members', world.memberOfDistrictOne, 'member', { memberId: member, districtId: world.districtOne }));
    expect(response.status).toBe(403);
  });
});

describe('A11 through the entry point', () => {
  it('issues a licence with one audit entry the attendant can read, and refuses a second one', async () => {
    const attendant = await createPerson('attendant');
    const first = await application.handle(post('/licences', world.chair, 'chair', { attendantId: attendant }));
    expect(first.status).toBe(201);
    const second = await application.handle(post('/licences', world.chair, 'chair', { attendantId: attendant }));
    expect(second).toEqual({ status: 409, body: { error: 'already licensed' } });
    const asAttendant = await application.audit.readByScope({ personId: attendant, role: 'attendant' });
    expect(asAttendant.map((entry) => entry.operation)).toEqual(['licences.issue']);
  });

  it('answers the licence status of an attendant never licensed with 200, no state and an empty history (P23 #10)', async () => {
    const attendant = await createPerson('attendant');
    valueOf(await world.licensing.assignments.assignAttendantToSite(world.chair, attendant, world.siteOne, 'morning'));
    const response = await application.handle(readRequest('/licences/status', tokenFor('chair', { personId: world.chair }), { attendantId: attendant, siteId: world.siteOne }));
    expect(response).toEqual({ status: 200, body: { attendantId: attendant, licenceId: null, state: null, history: [] } });
  });

  it('refuses a member the licence status of an attendant assigned outside their district, even when the query names a site inside it (P10)', async () => {
    const elsewhere = await createPerson('attendant');
    valueOf(await world.licensing.assignments.assignAttendantToSite(world.chair, elsewhere, world.siteTwo, 'morning'));
    const unassigned = await createPerson('attendant');
    const memberToken = tokenFor('member', { personId: world.memberOfDistrictOne });
    const ownDistrictNamed = await application.handle(readRequest('/licences/status', memberToken, { attendantId: elsewhere, siteId: world.siteOne }));
    const unassignedAttendant = await application.handle(readRequest('/licences/status', memberToken, { attendantId: unassigned, siteId: world.siteOne }));
    const otherDistrictNamed = await application.handle(readRequest('/licences/status', memberToken, { attendantId: elsewhere, siteId: world.siteTwo }));
    expect([ownDistrictNamed, unassignedAttendant]).toEqual([
      { status: 403, body: { error: 'not allowed here' } },
      { status: 403, body: { error: 'not allowed here' } },
    ]);
    expect(otherDistrictNamed.status).toBe(403);
    expect((await application.handle(readRequest('/licences/status', tokenFor('chair', { personId: world.chair }), { attendantId: unassigned }))).status).toBe(200);
  });
});

describe('A13 and A14 through the entry point', () => {
  it('clocks an attendant in and out by scanning their site\'s code, each with one audit entry, and names each refusal', async () => {
    const attendant = await licensedAttendantAtSiteOne();
    const { entryCode, exitCode } = await world.registry.issueEntryAndExitCodes(world.siteOne);
    const siteTwoCodes = await world.registry.issueEntryAndExitCodes(world.siteTwo);
    const wrongSite = await application.handle(post('/attendance/clock-in', attendant, 'attendant', { siteCode: siteTwoCodes.entryCode }));
    expect(wrongSite).toEqual({ status: 403, body: { error: 'wrong site' } });
    const notClockedIn = await application.handle(post('/attendance/clock-out', attendant, 'attendant', { siteCode: exitCode }));
    expect(notClockedIn).toEqual({ status: 409, body: { error: 'not clocked in' } });
    expect((await application.handle(post('/attendance/clock-in', attendant, 'attendant', { siteCode: entryCode }))).status).toBe(200);
    const twice = await application.handle(post('/attendance/clock-in', attendant, 'attendant', { siteCode: entryCode }));
    expect(twice).toEqual({ status: 409, body: { error: 'already clocked in' } });
    expect((await application.handle(post('/attendance/clock-out', attendant, 'attendant', { siteCode: exitCode }))).status).toBe(200);
    const alreadyOut = await application.handle(post('/attendance/clock-out', attendant, 'attendant', { siteCode: exitCode }));
    expect(alreadyOut).toEqual({ status: 409, body: { error: 'already clocked out' } });
    const entries = await application.audit.readByScope({ personId: attendant, role: 'attendant' });
    expect(entries.map((entry) => entry.operation)).toEqual(['attendance.clockIn', 'attendance.clockOut']);
  });

  it('takes a location reading as telemetry (P7): 204, no request id, no audit entry, only the distance kept', async () => {
    const attendant = await licensedAttendantAtSiteOne();
    const { entryCode } = await world.registry.issueEntryAndExitCodes(world.siteOne);
    await application.handle(post('/attendance/clock-in', attendant, 'attendant', { siteCode: entryCode }));
    const response = await application.handle(reading(attendant, 30.0626 + 600 / 111_195, 31.2197));
    expect(response.status).toBe(204);
    const [shift] = await world.stores.attendance.all(application.database);
    const readings = await world.stores.offSite.readingsOf(application.database, shift?.attendanceId ?? '');
    expect(readings).toHaveLength(1);
    expect(readings[0]?.distanceMeters).toBe(600);
    expect(JSON.stringify(readings)).not.toContain('31.2197');
    expect((await application.audit.readByScope({ personId: attendant, role: 'attendant' })).map((entry) => entry.operation)).toEqual(['attendance.clockIn']);
  });

  it('refuses the off-site flags of a zone to an inspector of another zone, through the pipeline\'s scope check (P10)', async () => {
    const inspectorOfZoneTwo = await createPerson('inspector');
    const zoneTwo = (await world.registry.locateSite(world.siteTwo))?.zoneId ?? '';
    const zoneOne = (await world.registry.locateSite(world.siteOne))?.zoneId ?? '';
    valueOf(await world.licensing.assignments.assignInspectorToZone(world.chair, inspectorOfZoneTwo, zoneTwo));
    const token = tokenFor('inspector', { personId: inspectorOfZoneTwo });
    expect((await application.handle(readRequest('/attendance/off-site-flags', token, { zoneId: zoneOne }))).status).toBe(403);
    expect(await application.handle(readRequest('/attendance/off-site-flags', token, { zoneId: zoneTwo }))).toEqual({ status: 200, body: { flags: [] } });
  });

  it('drops a reading from an attendant who is not clocked in, with 204 and nothing stored', async () => {
    const attendant = await licensedAttendantAtSiteOne();
    expect((await application.handle(reading(attendant, 30.0626, 31.2197))).status).toBe(204);
    expect(await world.stores.attendance.all(application.database)).toEqual([]);
  });
});
