import { isLocalDateTime, isPoint, type LocalDateTime } from '../../../shared/body-schema';
import type { Clock } from '../../../shared/clock';
import { refuse, respond, type ReadOperation, type WriteOperation } from '../../../shared/operation-contract';
import type { GeoPoint, SiteRegistry, SpecialEventKind } from './index';
import { parseWeeklyHours } from './domain/site-calendar';
import { EXAMPLE_OUTLINE, SAMPLE, refused, seedCommitteeAndPlaces, written } from './controller-support';

export function createSite(registry: SiteRegistry): WriteOperation {
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

export function replaceSiteOutline(registry: SiteRegistry): WriteOperation {
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

export function changeCapacity(registry: SiteRegistry): WriteOperation {
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
export function setWeeklyHours(registry: SiteRegistry): WriteOperation {
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
export function declareSpecialEvent(registry: SiteRegistry): WriteOperation {
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
export function readSiteStatus(registry: SiteRegistry, clock: Clock): ReadOperation {
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
export function readNearbySites(registry: SiteRegistry): ReadOperation {
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
export function readCapacityHistory(registry: SiteRegistry): ReadOperation {
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

export function readSiteDetails(registry: SiteRegistry): ReadOperation {
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
