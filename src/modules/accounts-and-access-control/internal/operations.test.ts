import { beforeEach, describe, expect, it } from 'vitest';
import { composeInMemoryApplication, type InMemoryApplication } from '../../../entrypoint/composition';
import { loggedReadRequest, readRequest, TEST_TOKEN_SECRET, tokenFor, writeRequest } from '../../../entrypoint/test-helpers';
import type { HttpRequest } from '../../../entrypoint/http';
import type { PersonId, Role } from '../../../shared/identifiers';
import { createAccountsOperations, type SiteLocator } from '../public';
import { createAccountsWorld, type AccountsWorld } from './testing/accounts-world';

/** This module's requests through the real entry point: token, role, scope, request id, one audit entry per logged read or write. */
const siteLocator: SiteLocator = {
  locateSite: async (siteId) => (siteId === 'site-a' ? { zoneId: 'zone-a', districtId: 'district-1' } : undefined),
  locateZone: async (zoneId) => (zoneId === 'zone-a' ? { districtId: 'district-1' } : undefined),
};

let world: AccountsWorld;
let application: InMemoryApplication;
let driver: PersonId;
let inspector: PersonId;
let carRef: string;
let requestCounter = 0;

function nextRequestId(): string {
  return `request-${String(++requestCounter).padStart(4, '0')}`;
}

/** The test helpers sign for "<role>-1"; this module's people have real references, so the token is re-signed for them. */
function asPerson(request: HttpRequest, personId: PersonId, role: Role): HttpRequest {
  return { ...request, headers: { ...request.headers, authorization: `Bearer ${tokenFor(role, { personId })}` } };
}

function plateLookUp(query: Record<string, string>): HttpRequest {
  return asPerson(loggedReadRequest('/plates', 'inspector', nextRequestId(), query), inspector, 'inspector');
}

function valueOf<Value>(outcome: { ok: true; value: Value } | { ok: false; error: string }): Value {
  if (!outcome.ok) {
    throw new Error(`set-up refused: ${outcome.error}`);
  }
  return outcome.value;
}

async function auditOperationsSeenBy(personId: PersonId, role: 'driver' | 'inspector' | 'chair') {
  return (await application.audit.readByScope({ personId, role })).map((entry) => entry.operation);
}

beforeEach(async () => {
  world = createAccountsWorld(siteLocator);
  application = composeInMemoryApplication({
    tokenSecret: TEST_TOKEN_SECRET,
    accessChecks: world.accounts.authorization,
    additionalOperations: createAccountsOperations(world.accounts),
  });
  const chair = valueOf(await world.accounts.bootstrapChair('01000000000', 'The Chair'));
  driver = valueOf(await world.accounts.personalData.createPerson('self registration', 'driver', '01011111111', 'Mona Adel'));
  inspector = valueOf(await world.accounts.personalData.createPerson(chair, 'inspector', '01044444444', 'Inspector A'));
  carRef = valueOf(await world.accounts.personalData.addCar(driver, 'ABC 123'));
  await world.accounts.accessFacts.recordInspectorZone(inspector, 'zone-a');
});

describe('A4 through the entry point', () => {
  it('shows a driver their own cars without a request id and without an audit entry (one\'s own data, P9)', async () => {
    const cars = await application.handle(readRequest('/cars', tokenFor('driver', { personId: driver })));
    expect(cars).toEqual({ status: 200, body: { cars: [{ carRef, plate: 'ABC123' }] } });
    expect(await auditOperationsSeenBy(driver, 'driver')).toEqual([]);
  });

  it('serves an inspector of the zone a plate as a logged read: one entry naming the reader, the car reference and the owner, never the plate', async () => {
    const lookUp = await application.handle(plateLookUp({ carRef, siteId: 'site-a' }));
    expect(lookUp).toEqual({ status: 200, body: { plate: 'ABC123' } });
    const [entry] = await application.audit.readByScope({ personId: driver, role: 'driver' });
    expect(entry).toMatchObject({
      operation: 'personalData.lookUpPlate',
      personId: inspector,
      role: 'inspector',
      input: { carRef, siteId: 'site-a' },
      subjectPersonIds: [driver],
      districtId: 'district-1',
    });
    expect(JSON.stringify(entry)).not.toContain('ABC123');
  });

  it('refuses the look-up without a request id, and outside the inspector\'s scope, each with no audit entry', async () => {
    const withoutId = await application.handle(readRequest('/plates', tokenFor('inspector', { personId: inspector }), { carRef, siteId: 'site-a' }));
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
      const inScope = await application.handle(plateLookUp({ carRef, siteId: 'site-a' }));
      const outOfScope = await application.handle(plateLookUp({ carRef, siteId: 'site-x' }));
      served += [inScope, outOfScope].filter((response) => response.status === 200).length;
    }
    const logged = (await auditOperationsSeenBy(driver, 'driver')).filter((operation) => operation === 'personalData.lookUpPlate').length;
    expect(served).toBe(10);
    expect(logged).toBe(served);
    console.log(`A4 report: plate reads logged ${logged} / plate reads served ${served} (100 %); 10 refused reads served nothing and logged nothing`);
  });
});
