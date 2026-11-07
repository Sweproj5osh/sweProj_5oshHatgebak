import { beforeEach, describe, expect, it } from 'vitest';
import type { CarRef, SiteLocator } from '../public';
import type { PersonId } from '../../../shared/identifiers';
import { createAccountsWorld, type AccountsWorld } from './testing/accounts-world';

/**
 * Task A4: save a car to a driver; show its plate only through a role-checked join. The one audit entry per plate served
 * is the pipeline's (P9); operations.test.ts proves it through the entry point, this file proves the module's answers.
 */
const siteLocator: SiteLocator = {
  locateSite: async (siteId) =>
    ({ 'site-a': { zoneId: 'zone-a', districtId: 'district-1' }, 'site-b': { zoneId: 'zone-b', districtId: 'district-1' } })[siteId],
  locateZone: async (zoneId) => ({ 'zone-a': { districtId: 'district-1' }, 'zone-b': { districtId: 'district-1' } })[zoneId],
};

let world: AccountsWorld;
let driver: PersonId;
let attendantOfSiteA: PersonId;
let attendantOfSiteB: PersonId;
let inspectorOfZoneA: PersonId;
let carRef: CarRef;

async function created(outcome: Promise<{ ok: true; value: PersonId } | { ok: false; error: string }>): Promise<PersonId> {
  const result = await outcome;
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

beforeEach(async () => {
  world = createAccountsWorld(siteLocator);
  const chair = await created(world.accounts.bootstrapChair('01000000000', 'The Chair'));
  driver = await created(world.accounts.personalData.createPerson('self registration', 'driver', '01011111111', 'Mona Adel'));
  attendantOfSiteA = await created(world.accounts.personalData.createPerson(chair, 'attendant', '01022222222', 'Attendant A'));
  attendantOfSiteB = await created(world.accounts.personalData.createPerson(chair, 'attendant', '01033333333', 'Attendant B'));
  inspectorOfZoneA = await created(world.accounts.personalData.createPerson(chair, 'inspector', '01044444444', 'Inspector A'));
  for (const [attendant, siteId] of [[attendantOfSiteA, 'site-a'], [attendantOfSiteB, 'site-b']] as const) {
    await world.accounts.accessFacts.recordAttendantSite(world.database, attendant, siteId);
    await world.accounts.accessFacts.recordLicenceState(world.database, attendant, 'valid');
  }
  await world.accounts.accessFacts.recordInspectorZone(world.database, inspectorOfZoneA, 'zone-a');
  const added = await world.accounts.personalData.addCar(driver, 'abc 123');
  if (!added.ok) {
    throw new Error(added.error);
  }
  carRef = added.value;
});

describe('A4 the task sheet cases', () => {
  it('serves the plate for the driver\'s own receipt, naming the owner and the district for the audit entry', async () => {
    expect(await world.accounts.personalData.readPlate({ carRef, reader: driver, purpose: 'receipt', siteId: 'site-a' })).toEqual({
      ok: true,
      value: { plate: 'ABC123', ownerRef: driver, districtId: 'district-1' },
    });
  });

  it('refuses an attendant of another site', async () => {
    expect(await world.accounts.personalData.readPlate({ carRef, reader: attendantOfSiteB, purpose: 'cash list', siteId: 'site-a' })).toEqual({
      ok: false,
      error: 'refused',
    });
  });
});

describe('A4 the rest of the join', () => {
  it('serves the attendant of the site for the cash list and the inspector of the zone for a look-up', async () => {
    expect((await world.accounts.personalData.readPlate({ carRef, reader: attendantOfSiteA, purpose: 'cash list', siteId: 'site-a' })).ok).toBe(true);
    expect((await world.accounts.personalData.readPlate({ carRef, reader: inspectorOfZoneA, purpose: 'inspector look-up', siteId: 'site-a' })).ok).toBe(true);
  });

  it('refuses a purpose the reader\'s role does not have, a reader without scope over the site, and a suspended attendant', async () => {
    const read = world.accounts.personalData.readPlate.bind(world.accounts.personalData);
    expect(await read({ carRef, reader: attendantOfSiteA, purpose: 'inspector look-up', siteId: 'site-a' })).toEqual({ ok: false, error: 'refused' });
    expect(await read({ carRef, reader: inspectorOfZoneA, purpose: 'inspector look-up', siteId: 'site-b' })).toEqual({ ok: false, error: 'refused' });
    await world.accounts.accessFacts.recordLicenceState(world.database, attendantOfSiteA, 'suspended');
    expect(await read({ carRef, reader: attendantOfSiteA, purpose: 'cash list', siteId: 'site-a' })).toEqual({ ok: false, error: 'refused' });
  });

  it('answers "not resolvable" for an unknown car', async () => {
    expect(await world.accounts.personalData.readPlate({ carRef: 'car-unknown', reader: driver, purpose: 'receipt', siteId: 'site-a' })).toEqual({
      ok: false,
      error: 'not resolvable',
    });
  });

  it('saves a car once per plate, shows a driver their own cars, and refuses a non-driver or a bad plate', async () => {
    expect(await world.accounts.personalData.addCar(driver, 'ABC-123')).toEqual({ ok: true, value: carRef });
    const second = await world.accounts.personalData.addCar(driver, 'xyz 9');
    expect(second.ok).toBe(true);
    expect((await world.accounts.personalData.ownCars(driver)).map((car) => car.plate)).toEqual(['ABC123', 'XYZ9']);
    expect(await world.accounts.personalData.addCar(attendantOfSiteA, 'ABC 123')).toEqual({ ok: false, error: 'not a driver' });
    expect(await world.accounts.personalData.addCar(driver, 'ب ج د ١٢٣')).toEqual({ ok: false, error: 'invalid plate' });
    expect(await world.accounts.personalData.addCar(driver, '')).toEqual({ ok: false, error: 'invalid plate' });
  });

  it('keeps the plate in the personal-data store only', async () => {
    expect(await world.stores.personalData.car(world.database, carRef)).toEqual({ carRef, ownerRef: driver, plate: 'ABC123' });
    expect(JSON.stringify(await world.stores.people.find(world.database, driver))).not.toContain('ABC123');
  });
});
