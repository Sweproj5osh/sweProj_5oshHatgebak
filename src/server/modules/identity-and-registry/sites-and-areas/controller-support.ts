import type { DistrictId } from '../../../shared/identifiers';
import { refuse, respond, type WriteOutcome } from '../../../shared/operation-contract';
import type { TableAccess } from '../../../shared/unit-of-work';
import { createAccountsStores } from '../accounts-and-access-control/index';
import { createSitesStores, type GeoPoint, type PlaceRefusal } from './index';

export const EXAMPLE_OUTLINE: readonly GeoPoint[] = [
  { latitude: 30.0624, longitude: 31.2195 },
  { latitude: 30.0624, longitude: 31.2199 },
  { latitude: 30.0628, longitude: 31.2199 },
  { latitude: 30.0628, longitude: 31.2195 },
];

/** The places the sample bodies of the F5 harness name, seeded by each write's fixture (P26 Q10). */
export const SAMPLE = { chair: 'chair-1', member: 'member-1', districtId: 'district-1', zoneId: 'zone-1', siteId: 'site-1' } as const;

export function written(status: number, body: unknown, districtId: DistrictId | undefined): WriteOutcome {
  return { response: respond(status, body), audit: districtId === undefined ? {} : { districtId } };
}

const REFUSAL_STATUS: Readonly<Record<PlaceRefusal, number>> = {
  'not allowed here': 403,
  'unknown district': 404,
  'invalid label': 400,
  'invalid outline': 400,
  'invalid capacity': 400,
  'reason required': 400,
  'invalid hours': 400,
  'invalid period': 400,
};

export function refused(refusal: PlaceRefusal): WriteOutcome {
  return { response: refuse(REFUSAL_STATUS[refusal], refusal) };
}

/** The Chair and a member of district 1 the sample bodies act as, seeded through the accounts module's own stores. */
export async function seedCommittee(database: TableAccess): Promise<void> {
  const accounts = createAccountsStores();
  await accounts.people.add(database, { personId: SAMPLE.chair, role: 'chair', status: 'active', erased: false });
  await accounts.people.add(database, { personId: SAMPLE.member, role: 'member', status: 'active', erased: false });
  await accounts.accessFacts.update(database, SAMPLE.member, (facts) => ({ ...facts, memberDistrictId: SAMPLE.districtId }));
}

/** Seeds district 1 with zone 1 and site 1 inside it, for the sample bodies that name a place (P26 Q10). */
export async function seedCommitteeAndPlaces(database: TableAccess): Promise<void> {
  await seedCommittee(database);
  const sites = createSitesStores();
  await sites.places.addDistrict(database, { districtId: SAMPLE.districtId, label: 'Zamalek' });
  await sites.places.addZone(database, { zoneId: SAMPLE.zoneId, districtId: SAMPLE.districtId, label: 'Zamalek zone 1' });
  await sites.places.addSite(database, { siteId: SAMPLE.siteId, zoneId: SAMPLE.zoneId, label: '26 July Street', outline: EXAMPLE_OUTLINE });
  await sites.capacity.append(database, { siteId: SAMPLE.siteId, capacity: 12, reason: 'sample', changedBy: SAMPLE.chair, changedAt: '2026-11-05T08:00:00.000Z' });
}
