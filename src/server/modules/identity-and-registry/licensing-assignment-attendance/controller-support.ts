import type { PersonId, Role } from '../../../shared/identifiers';
import { refuse, type WriteOutcome } from '../../../shared/operation-contract';
import type { TableAccess } from '../../../shared/unit-of-work';
import { createAccountsStores } from '../accounts-and-access-control/index';
import { createSitesStores } from '../sites-and-areas/index';
import { createLicensingStores, type AssignmentRefusal } from './index';

const REFUSAL_STATUS: Readonly<Record<AssignmentRefusal, number>> = {
  'one site per attendant': 409,
  'members are managed by the Chair only': 403,
  'not allowed here': 403,
  'not an attendant': 400,
  'not an inspector': 400,
  'not a member': 400,
  'not assigned': 404,
  'unknown site': 404,
  'unknown zone': 404,
  'unknown district': 404,
  'invalid shift': 400,
};

export function refused(refusal: AssignmentRefusal): WriteOutcome {
  return { response: refuse(REFUSAL_STATUS[refusal], refusal) };
}

/** The people and places the sample bodies of the F5 harness name, seeded by each write's fixture (P26 Q10). */
export const SAMPLE = {
  chair: 'chair-1',
  member: 'member-1',
  attendant: 'person-1',
  inspector: 'person-2',
  districtId: 'district-1',
  zoneId: 'zone-1',
  siteId: 'site-1',
} as const;

const SAMPLE_OUTLINE = [
  { latitude: 30.0624, longitude: 31.2195 },
  { latitude: 30.0624, longitude: 31.2199 },
  { latitude: 30.0628, longitude: 31.2199 },
  { latitude: 30.0628, longitude: 31.2195 },
];

export async function seedPerson(database: TableAccess, personId: PersonId, role: Role): Promise<void> {
  await createAccountsStores().people.add(database, { personId, role, status: 'active', erased: false });
}

/** A member of district 1, and district 1 with zone 1 and site 1 inside it, through the owning modules' own stores. */
export async function seedMemberAndPlaces(database: TableAccess): Promise<void> {
  const accounts = createAccountsStores();
  await seedPerson(database, SAMPLE.member, 'member');
  await accounts.accessFacts.update(database, SAMPLE.member, (facts) => ({ ...facts, memberDistrictId: SAMPLE.districtId }));
  const sites = createSitesStores();
  await sites.places.addDistrict(database, { districtId: SAMPLE.districtId, label: 'Zamalek' });
  await sites.places.addZone(database, { zoneId: SAMPLE.zoneId, districtId: SAMPLE.districtId, label: 'Zamalek zone 1' });
  await sites.places.addSite(database, { siteId: SAMPLE.siteId, zoneId: SAMPLE.zoneId, label: '26 July Street', outline: SAMPLE_OUTLINE });
}

export async function seedMemberAndAttendantAtSiteOne(database: TableAccess): Promise<void> {
  await seedMemberAndPlaces(database);
  await seedPerson(database, SAMPLE.attendant, 'attendant');
}

export async function seedAssignedAttendant(database: TableAccess): Promise<void> {
  await seedMemberAndAttendantAtSiteOne(database);
  await assignToSiteOne(database, SAMPLE.attendant);
}

export async function seedLicensedAttendantAtSiteOne(database: TableAccess, attendantId: PersonId): Promise<void> {
  await seedMemberAndPlaces(database);
  await seedPerson(database, attendantId, 'attendant');
  await assignToSiteOne(database, attendantId);
  await createAccountsStores().accessFacts.update(database, attendantId, (facts) => ({ ...facts, licenceState: 'valid' }));
}

async function assignToSiteOne(database: TableAccess, attendantId: PersonId): Promise<void> {
  await createLicensingStores().assignments.saveAttendant(database, {
    attendantId,
    siteId: SAMPLE.siteId,
    shiftId: 'morning',
    assignedBy: SAMPLE.member,
    assignedAt: '2026-11-05T08:00:00.000Z',
  });
  await createAccountsStores().accessFacts.update(database, attendantId, (facts) => ({ ...facts, attendantSiteId: SAMPLE.siteId }));
}
