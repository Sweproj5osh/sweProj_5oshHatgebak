import type { WriteOperation } from '../../../shared/operation-contract';
import type { SiteRegistry } from './index';
import { SAMPLE, refused, seedCommitteeAndPlaces, written } from './controller-support';

export function createZone(registry: SiteRegistry): WriteOperation {
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

export function relabelZone(registry: SiteRegistry): WriteOperation {
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
