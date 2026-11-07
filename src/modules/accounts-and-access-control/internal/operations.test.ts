import { beforeEach, describe, expect, it } from 'vitest';
import { composeInMemoryServer, type InMemoryApplication } from '../../../entrypoint/composition';
import type { HttpRequest } from '../../../entrypoint/http';
import { loggedReadRequest, publicRequest, readRequest, TEST_TOKEN_SECRET, tokenFor, writeRequest } from '../../../entrypoint/test-helpers';
import { FixedClock } from '../../../shared/clock';
import type { PersonId, Role } from '../../../shared/identifiers';
import { REQUEST_SIGN_IN_CODE_PATH, SIGN_IN_PATH } from './operations';

/**
 * This module's requests through the composed in-memory server: the real accounts module answers live status and
 * scope, the pipeline writes one redacted audit entry per write or logged read, and sign-in is the one door without a token.
 */
let application: InMemoryApplication;
let clock: FixedClock;
let chair: PersonId;
let driver: PersonId;
let inspector: PersonId;
let siteId: string;
let carRef: string;
let requestCounter = 0;

const DRIVER_PHONE = '+201011111111';

function nextRequestId(): string {
  return `request-${String(++requestCounter).padStart(4, '0')}`;
}

/** The test helpers sign for "<role>-1"; this module's people have real references, so the token is re-signed for them. */
function asPerson(request: HttpRequest, personId: PersonId, role: Role): HttpRequest {
  return { ...request, headers: { ...request.headers, authorization: `Bearer ${tokenFor(role, { personId })}` } };
}

function plateLookUp(query: Record<string, string>): HttpRequest {
  return asPerson(loggedReadRequest('/plates/look-up', 'inspector', nextRequestId(), query), inspector, 'inspector');
}

function valueOf<Value>(outcome: { ok: true; value: Value } | { ok: false; error: string }): Value {
  if (!outcome.ok) {
    throw new Error(`set-up refused: ${outcome.error}`);
  }
  return outcome.value;
}

async function auditOperationsSeenBy(personId: PersonId, role: Role) {
  return (await application.audit.readByScope({ personId, role })).map((entry) => entry.operation);
}

async function requestCode(phone: string) {
  return application.handle(publicRequest(REQUEST_SIGN_IN_CODE_PATH, nextRequestId(), { phone }));
}

async function signIn(phone: string, code: string, password = '') {
  return application.handle(publicRequest(SIGN_IN_PATH, nextRequestId(), { phone, code, password }));
}

async function codeSentTo(phone: string): Promise<string> {
  await requestCode(phone);
  return application.signInCodes.lastCodeSentTo(phone) ?? 'no code was sent';
}

beforeEach(async () => {
  clock = new FixedClock(new Date('2026-11-05T08:00:00Z'));
  application = composeInMemoryServer({ tokenSecret: TEST_TOKEN_SECRET, clock });
  const { accounts, siteRegistry } = application.moduleDependencies;
  chair = valueOf(await accounts.bootstrapChair('01000000000', 'The Chair'));
  driver = valueOf(await accounts.personalData.createPerson('self registration', 'driver', DRIVER_PHONE, 'Mona Adel'));
  inspector = valueOf(await accounts.personalData.createPerson(chair, 'inspector', '01044444444', 'Inspector A'));
  carRef = valueOf(await accounts.personalData.addCar(driver, 'ABC 123'));
  const districtId = valueOf(await siteRegistry.createDistrict(chair, 'Zamalek'));
  const zoneId = valueOf(await siteRegistry.createZone(chair, districtId, 'Zamalek zone 1'));
  siteId = valueOf(
    await siteRegistry.createSite(chair, zoneId, '26 July Street', [{ latitude: 30.06, longitude: 31.22 }, { latitude: 30.06, longitude: 31.221 }, { latitude: 30.061, longitude: 31.221 }], 5),
  );
  await accounts.accessFacts.recordInspectorZone(application.database, inspector, zoneId);
});

describe('A1 sign-in through the entry point (P3, ADR-15)', () => {
  it('sends a code at POST /sign-in/code and signs in at POST /sign-in with a token the server then accepts', async () => {
    const code = await codeSentTo(DRIVER_PHONE);
    const signedIn = await signIn(DRIVER_PHONE, code);
    expect(signedIn.status).toBe(200);
    const token = (signedIn.body as { token: string }).token;
    expect(await application.handle(readRequest('/cars', token))).toEqual({ status: 200, body: { cars: [{ carRef, plate: 'ABC123' }] } });
  });

  it('writes one audit entry per public operation, naming the address and the person, never the phone or the code', async () => {
    const code = await codeSentTo(DRIVER_PHONE);
    await signIn(DRIVER_PHONE, code);
    const entries = await application.audit.readByScope({ personId: driver, role: 'driver' });
    expect(entries.map((entry) => [entry.operation, entry.actorKind, entry.subjectPersonIds])).toEqual([['signIn', 'anonymous', [driver]]]);
    const everything = await application.audit.readByScope({ personId: chair, role: 'chair' });
    expect(everything.map((entry) => entry.operation)).toEqual(['requestSignInCode', 'signIn']);
    expect(JSON.stringify(everything)).not.toMatch(/1011111111|Mona/);
    expect(JSON.stringify(everything)).not.toContain(code);
  });

  it('counts wrong codes per phone across new code requests, locks the phone, and refuses a new code while locked (P23)', async () => {
    const code = await codeSentTo(DRIVER_PHONE);
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await signIn(DRIVER_PHONE, wrong)).status).toBe(401);
    expect((await signIn(DRIVER_PHONE, wrong)).status).toBe(401);
    const freshCode = await codeSentTo(DRIVER_PHONE);
    const locked = await signIn(DRIVER_PHONE, freshCode === '000000' ? '111111' : '000000');
    expect(locked).toEqual({ status: 423, body: { error: 'locked' } });
    clock.advanceByMilliseconds(11 * 60_000);
    expect(await signIn(DRIVER_PHONE, freshCode)).toEqual({ status: 423, body: { error: 'locked' } });
    expect(await requestCode(DRIVER_PHONE)).toEqual({ status: 423, body: { error: 'locked' } });
    clock.advanceByMilliseconds(15 * 60_000);
    expect((await signIn(DRIVER_PHONE, await codeSentTo(DRIVER_PHONE))).status).toBe(200);
  });

  it('answers an unknown phone like a known one when a code is requested, and "wrong code" at sign-in', async () => {
    expect((await requestCode('01099999999')).status).toBe(202);
    expect(application.signInCodes.count()).toBe(0);
    expect(await signIn('01099999999', '123456')).toEqual({ status: 401, body: { error: 'wrong code' } });
  });

  it('needs a password as the second step for a member, set through the audited write that drops the password (A15, P2)', async () => {
    const member = valueOf(await application.moduleDependencies.accounts.personalData.createPerson(chair, 'member', '01022222222', 'A Member'));
    const set = await application.handle(asPerson(writeRequest('/committee/password', 'chair', nextRequestId(), { personId: member, password: 'correct horse battery staple' }), chair, 'chair'));
    expect(set.status).toBe(200);
    const code = await codeSentTo('+201022222222');
    expect(await signIn('+201022222222', code)).toEqual({ status: 401, body: { error: 'second step required' } });
    expect((await signIn('+201022222222', code, 'correct horse battery staple')).status).toBe(200);
    const entries = await application.audit.readByScope({ personId: chair, role: 'chair' });
    const passwordEntry = entries.find((entry) => entry.operation === 'signIn.setCommitteePassword');
    expect(passwordEntry?.input).toEqual({ personId: member });
    expect(JSON.stringify(entries)).not.toContain('correct horse');
  });
});

describe('A4 through the entry point', () => {
  it('shows a driver their own cars without a request id and without an audit entry (one\'s own data, P9)', async () => {
    const cars = await application.handle(readRequest('/cars', tokenFor('driver', { personId: driver })));
    expect(cars).toEqual({ status: 200, body: { cars: [{ carRef, plate: 'ABC123' }] } });
    expect(await auditOperationsSeenBy(driver, 'driver')).toEqual([]);
  });

  it('saves a car and creates a person through audited writes whose entries carry the references, never the plate, phone or name (P2)', async () => {
    const added = await application.handle(asPerson(writeRequest('/cars', 'driver', nextRequestId(), { plate: 'XYZ 9' }), driver, 'driver'));
    expect(added.status).toBe(201);
    const newCarRef = (added.body as { carRef: string }).carRef;
    const created = await application.handle(asPerson(writeRequest('/people', 'chair', nextRequestId(), { role: 'attendant', phone: '01033333333', displayName: 'An Attendant' }), chair, 'chair'));
    expect(created.status).toBe(201);
    const newPersonId = (created.body as { personId: string }).personId;
    const entries = await application.audit.readByScope({ personId: chair, role: 'chair' });
    expect(entries.map((entry) => [entry.operation, entry.input])).toEqual([
      ['personalData.addCar', { carRef: newCarRef }],
      ['personalData.createPerson', { role: 'attendant', personId: newPersonId }],
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/XYZ|1033333333|An Attendant/);
  });

  it('serves an inspector of the zone a plate as a logged read: one entry naming the reader, the car reference and the owner, never the plate', async () => {
    const lookUp = await application.handle(plateLookUp({ carRef, siteId }));
    expect(lookUp).toEqual({ status: 200, body: { plate: 'ABC123' } });
    const [entry] = await application.audit.readByScope({ personId: driver, role: 'driver' });
    expect(entry).toMatchObject({
      operation: 'personalData.lookUpPlate',
      personId: inspector,
      role: 'inspector',
      input: { carRef, siteId },
      subjectPersonIds: [driver],
    });
    expect(JSON.stringify(entry)).not.toContain('ABC123');
  });

  it('refuses the look-up without a request id, and outside the inspector\'s scope, each with no audit entry', async () => {
    const withoutId = await application.handle(readRequest('/plates/look-up', tokenFor('inspector', { personId: inspector }), { carRef, siteId }));
    const elsewhere = await application.handle(plateLookUp({ carRef, siteId: 'site-x' }));
    expect([withoutId.status, elsewhere.status]).toEqual([400, 403]);
    expect(await auditOperationsSeenBy(driver, 'driver')).toEqual([]);
  });

  it('lets a driver erase themself, with one audit entry that holds no personal data', async () => {
    const response = await application.handle(asPerson(writeRequest('/people/erasure', 'driver', nextRequestId(), { personId: driver }), driver, 'driver'));
    expect(response.status).toBe(200);
    const entries = await application.audit.readByScope({ personId: driver, role: 'driver' });
    expect(entries.map((entry) => entry.operation)).toEqual(['personalData.erase']);
    expect(JSON.stringify(entries)).not.toMatch(/Mona|1011111111/);
  });
});

describe('A4 report', () => {
  it('logs every plate served and nothing for a refused read', async () => {
    let served = 0;
    for (let index = 0; index < 10; index += 1) {
      const inScope = await application.handle(plateLookUp({ carRef, siteId }));
      const outOfScope = await application.handle(plateLookUp({ carRef, siteId: 'site-x' }));
      served += [inScope, outOfScope].filter((response) => response.status === 200).length;
    }
    const logged = (await auditOperationsSeenBy(driver, 'driver')).filter((operation) => operation === 'personalData.lookUpPlate').length;
    expect(served).toBe(10);
    expect(logged).toBe(served);
    console.log(`A4 report: plate reads logged ${logged} / plate reads served ${served} (100 %); 10 refused reads served nothing and logged nothing`);
  });
});
