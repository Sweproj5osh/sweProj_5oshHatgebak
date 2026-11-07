import { isLocalDateTime, isPoint, type LocalDateTime } from '../../../shared/body-schema';
import type { Clock } from '../../../shared/clock';
import type { DistrictId } from '../../../shared/identifiers';
import { refuse, respond, type Operation, type ReadOperation, type WriteOperation, type WriteOutcome } from '../../../shared/operation-contract';
import type { TableAccess } from '../../../shared/unit-of-work';
import { createAccountsStores } from '../../accounts-and-access-control/public';
import { createSitesStores, type GeoPoint, type PlaceRefusal, type SiteRegistry, type SpecialEventKind } from '../public';
import { parseWeeklyHours } from './domain/site-calendar';

export interface SitesOperationsDependencies {
  readonly siteRegistry: SiteRegistry;
  readonly clock: Clock;
}

/**
 * The requests this module answers, for the composition root to register (P4). The entry point checks the token, the
 * role, the request id and the body before a handler runs, and writes the one audit entry after it succeeds; the
 * handler adds the district so that members of that district can read the entry (ADR-10). An outline travels as a
 * list of points and a closure as two calendar times (P6); nothing time-like comes from a phone (Rule I).
 */
export function sitesOperations({ siteRegistry, clock }: SitesOperationsDependencies): readonly Operation[] {
  return [
    createDistrict(siteRegistry),
    relabelDistrict(siteRegistry),
    createZone(siteRegistry),
    relabelZone(siteRegistry),
    createSite(siteRegistry),
    replaceSiteOutline(siteRegistry),
    changeCapacity(siteRegistry),
    setWeeklyHours(siteRegistry),
    declareSpecialEvent(siteRegistry),
    readSiteDetails(siteRegistry),
    readSiteStatus(siteRegistry, clock),
    readNearbySites(siteRegistry),
    readCapacityHistory(siteRegistry),
  ];
}

const EXAMPLE_OUTLINE: readonly GeoPoint[] = [
  { latitude: 30.0624, longitude: 31.2195 },
  { latitude: 30.0624, longitude: 31.2199 },
  { latitude: 30.0628, longitude: 31.2199 },
  { latitude: 30.0628, longitude: 31.2195 },
];

/** The places the sample bodies of the F5 harness name, seeded by each write's fixture (P26 Q10). */
const SAMPLE = { chair: 'chair-1', member: 'member-1', districtId: 'district-1', zoneId: 'zone-1', siteId: 'site-1' } as const;

function createDistrict(registry: SiteRegistry): WriteOperation {
  return {
    kind: 'write',
    name: 'sites.createDistrict',
    method: 'POST',
    path: '/districts',
    allowedRoles: ['chair'],
    bodySchema: { fields: { label: 'string' } },
    examples: { valid: { label: 'Zamalek' }, invalid: { label: 7 } },
    fixture: (database) => seedCommittee(database),
    async handle({ actor, body }) {
      const created = await registry.createDistrict(actor.personId, String(body['label']));
      return created.ok ? written(201, { districtId: created.value }, created.value) : refused(created.error);
    },
  };
}

function relabelDistrict(registry: SiteRegistry): WriteOperation {
  return {
    kind: 'write',
    name: 'sites.relabelDistrict',
    method: 'POST',
    path: '/districts/label',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { districtId: 'string', label: 'string' } },
    examples: { valid: { districtId: SAMPLE.districtId, label: 'Zamalek North' }, invalid: {} },
    fixture: (database) => seedCommitteeAndPlaces(database),
    async handle({ actor, body }) {
      const districtId = String(body['districtId']);
      const relabelled = await registry.relabelDistrict(actor.personId, districtId, String(body['label']));
      return relabelled.ok ? written(200, { districtId }, districtId) : refused(relabelled.error);
    },
  };
}

function createZone(registry: SiteRegistry): WriteOperation {
  return {
    kind: 'write',
    name: 'sites.createZone',
    method: 'POST',
    path: '/zones',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { districtId: 'string', label: 'string' } },
    examples: { valid: { districtId: SAMPLE.districtId, label: 'Zamalek zone 1' }, invalid: {} },
    fixture: (database) => seedCommitteeAndPlaces(database),
    async handle({ actor, body }) {
      const districtId = String(body['districtId']);
      const created = await registry.createZone(actor.personId, districtId, String(body['label']));
      return created.ok ? written(201, { zoneId: created.value }, districtId) : refused(created.error);
    },
  };
}

function relabelZone(registry: SiteRegistry): WriteOperation {
  return {
    kind: 'write',
    name: 'sites.relabelZone',
    method: 'POST',
    path: '/zones/label',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { zoneId: 'string', label: 'string' } },
    examples: { valid: { zoneId: SAMPLE.zoneId, label: 'Zamalek zone 1 north' }, invalid: {} },
    fixture: (database) => seedCommitteeAndPlaces(database),
    async handle({ actor, body }) {
      const zoneId = String(body['zoneId']);
      const relabelled = await registry.relabelZone(actor.personId, zoneId, String(body['label']));
      if (!relabelled.ok) {
        return refused(relabelled.error);
      }
      return written(200, { zoneId }, (await registry.locateZone(zoneId))?.districtId);
    },
  };
}

function createSite(registry: SiteRegistry): WriteOperation {
  return {
    kind: 'write',
    name: 'sites.createSite',
    method: 'POST',
    path: '/sites',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { zoneId: 'string', label: 'string', outline: { list: 'point' }, capacity: 'number' } },
    examples: {
      valid: { zoneId: SAMPLE.zoneId, label: '26 July Street', outline: EXAMPLE_OUTLINE, capacity: 12 },
      invalid: { zoneId: SAMPLE.zoneId, label: '26 July Street', outline: EXAMPLE_OUTLINE, capacity: 'twelve' },
    },
    fixture: (database) => seedCommitteeAndPlaces(database),
    async handle({ actor, body }) {
      const zoneId = String(body['zoneId']);
      const created = await registry.createSite(actor.personId, zoneId, String(body['label']), pointsOf(body['outline']), Number(body['capacity']));
      if (!created.ok) {
        return refused(created.error);
      }
      return written(201, { siteId: created.value }, (await registry.locateZone(zoneId))?.districtId);
    },
  };
}

function replaceSiteOutline(registry: SiteRegistry): WriteOperation {
  return {
    kind: 'write',
    name: 'sites.replaceOutline',
    method: 'POST',
    path: '/sites/outline',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { siteId: 'string', outline: { list: 'point' } } },
    examples: { valid: { siteId: SAMPLE.siteId, outline: EXAMPLE_OUTLINE }, invalid: { siteId: SAMPLE.siteId } },
    fixture: (database) => seedCommitteeAndPlaces(database),
    async handle({ actor, body }) {
      const siteId = String(body['siteId']);
      const replaced = await registry.replaceSiteOutline(actor.personId, siteId, pointsOf(body['outline']));
      return replaced.ok ? written(200, { siteId }, (await registry.locateSite(siteId))?.districtId) : refused(replaced.error);
    },
  };
}

function changeCapacity(registry: SiteRegistry): WriteOperation {
  return {
    kind: 'write',
    name: 'sites.changeCapacity',
    method: 'POST',
    path: '/sites/capacity',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { siteId: 'string', capacity: 'number', reason: 'string' } },
    examples: { valid: { siteId: SAMPLE.siteId, capacity: 8, reason: 'Two spaces repainted' }, invalid: { siteId: SAMPLE.siteId, capacity: 8 } },
    fixture: (database) => seedCommitteeAndPlaces(database),
    async handle({ actor, body }) {
      const siteId = String(body['siteId']);
      const reason = String(body['reason']);
      const changed = await registry.changeCapacity(actor.personId, siteId, Number(body['capacity']), reason);
      if (!changed.ok) {
        return refused(changed.error);
      }
      const districtId = (await registry.locateSite(siteId))?.districtId;
      return {
        response: respond(200, { siteId, capacity: await registry.capacityOf(siteId) }),
        audit: districtId === undefined ? { reason } : { reason, districtId },
      };
    },
  };
}

/** Weekly hours travel as text, for example "sun-thu 08:00-22:00; fri 13:00-23:00"; "daily 00:00-24:00" is always open. */
function setWeeklyHours(registry: SiteRegistry): WriteOperation {
  return {
    kind: 'write',
    name: 'sites.setWeeklyHours',
    method: 'POST',
    path: '/sites/hours',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { siteId: 'string', hours: 'string' } },
    examples: { valid: { siteId: SAMPLE.siteId, hours: 'daily 08:00-23:00' }, invalid: { siteId: SAMPLE.siteId } },
    fixture: (database) => seedCommitteeAndPlaces(database),
    async handle({ actor, body }) {
      const periods = parseWeeklyHours(String(body['hours']));
      if (!periods.ok) {
        return refused(periods.error);
      }
      const siteId = String(body['siteId']);
      const set = await registry.setWeeklyHours(actor.personId, siteId, periods.value);
      return set.ok ? written(200, { siteId }, (await registry.locateSite(siteId))?.districtId) : refused(set.error);
    },
  };
}

const SPECIAL_EVENT_KINDS: readonly SpecialEventKind[] = ['closure', 'free period'];

/**
 * A closure or a free period as the committee declares it, from one Cairo local minute until another (P6): the two
 * calendar times are committee-declared facts, not a phone's clock reading, which is why only committee roles may send them.
 */
function declareSpecialEvent(registry: SiteRegistry): WriteOperation {
  return {
    kind: 'write',
    name: 'sites.declareSpecialEvent',
    method: 'POST',
    path: '/sites/special-events',
    allowedRoles: ['member', 'chair'],
    bodySchema: { fields: { siteId: 'string', kind: 'string', from: 'localDateTime', until: 'localDateTime', reason: 'string' } },
    examples: {
      valid: {
        siteId: SAMPLE.siteId,
        kind: 'closure',
        from: { year: 2026, month: 11, day: 20, hour: 18, minute: 0 },
        until: { year: 2026, month: 11, day: 20, hour: 23, minute: 0 },
        reason: 'Football match at the stadium',
      },
      invalid: { siteId: SAMPLE.siteId, kind: 'closure', from: '2026-11-20T18:00:00Z', until: '2026-11-20T23:00:00Z', reason: 'match' },
    },
    fixture: (database) => seedCommitteeAndPlaces(database),
    async handle({ actor, body }) {
      const kind = body['kind'];
      if (!isSpecialEventKind(kind)) {
        return { response: refuse(400, `kind must be one of ${SPECIAL_EVENT_KINDS.join(', ')}`) };
      }
      const siteId = String(body['siteId']);
      const reason = String(body['reason']);
      const declared = await registry.declareSpecialEvent(actor.personId, siteId, kind, localDateTimeOf(body['from']), localDateTimeOf(body['until']), reason);
      if (!declared.ok) {
        return refused(declared.error);
      }
      const districtId = (await registry.locateSite(siteId))?.districtId;
      return { response: respond(201, { eventId: declared.value }), audit: districtId === undefined ? { reason } : { reason, districtId } };
    },
  };
}

function isSpecialEventKind(candidate: unknown): candidate is SpecialEventKind {
  return typeof candidate === 'string' && (SPECIAL_EVENT_KINDS as readonly string[]).includes(candidate);
}

/** Open or closed now, by the server clock: the moment is never taken from the request. */
function readSiteStatus(registry: SiteRegistry, clock: Clock): ReadOperation {
  return {
    kind: 'read',
    name: 'sites.statusNow',
    method: 'GET',
    path: '/sites/status',
    allowedRoles: ['driver', 'attendant', 'inspector', 'member', 'chair'],
    scope: 'open',
    async handle({ query }) {
      const status = await registry.statusAt(query['siteId'] ?? '', clock.now());
      return { response: status === undefined ? refuse(404, 'unknown site') : respond(200, status) };
    },
  };
}

/** The driver's map: GET /sites/nearby?latitude=30.06&longitude=31.22&radius=1500 (radius in metres). */
function readNearbySites(registry: SiteRegistry): ReadOperation {
  return {
    kind: 'read',
    name: 'sites.nearby',
    method: 'GET',
    path: '/sites/nearby',
    allowedRoles: ['driver', 'attendant', 'inspector', 'member', 'chair'],
    scope: 'open',
    async handle({ query }) {
      const from = { latitude: Number(query['latitude']), longitude: Number(query['longitude']) };
      const nearby = await registry.nearbySites(from, Number(query['radius']));
      return { response: nearby.ok ? respond(200, { sites: nearby.value }) : refuse(400, nearby.error) };
    },
  };
}

/** Who changed what and why names people, so the read is staff-scoped (P10): Chair, the district's members, the zone's inspector. */
function readCapacityHistory(registry: SiteRegistry): ReadOperation {
  return {
    kind: 'read',
    name: 'sites.capacityHistory',
    method: 'GET',
    path: '/sites/capacity-history',
    allowedRoles: ['inspector', 'member', 'chair'],
    scope: 'staff-scoped',
    async handle({ query }) {
      const siteId = query['siteId'] ?? '';
      if ((await registry.locateSite(siteId)) === undefined) {
        return { response: refuse(404, 'unknown site') };
      }
      return { response: respond(200, { siteId, history: await registry.capacityHistory(siteId) }) };
    },
  };
}

function readSiteDetails(registry: SiteRegistry): ReadOperation {
  return {
    kind: 'read',
    name: 'sites.details',
    method: 'GET',
    path: '/sites/details',
    allowedRoles: ['driver', 'attendant', 'inspector', 'member', 'chair'],
    scope: 'open',
    async handle({ query }) {
      const details = await registry.siteDetails(query['siteId'] ?? '');
      return { response: details === undefined ? refuse(404, 'unknown site') : respond(200, details) };
    },
  };
}

/** The schema already validated a list of points; this only narrows the type. */
function pointsOf(outline: unknown): readonly GeoPoint[] {
  return Array.isArray(outline) ? outline.filter(isPoint) : [];
}

/** The schema already validated a localDateTime; this only narrows the type. */
function localDateTimeOf(value: unknown): LocalDateTime {
  if (!isLocalDateTime(value)) {
    throw new Error('a localDateTime field passed validation but is not one');
  }
  return value;
}

function written(status: number, body: unknown, districtId: DistrictId | undefined): WriteOutcome {
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

function refused(refusal: PlaceRefusal): WriteOutcome {
  return { response: refuse(REFUSAL_STATUS[refusal], refusal) };
}

/** The Chair and a member of district 1 the sample bodies act as, seeded through the accounts module's own stores. */
async function seedCommittee(database: TableAccess): Promise<void> {
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
