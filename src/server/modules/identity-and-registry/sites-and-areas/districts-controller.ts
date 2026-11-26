import type { WriteOperation } from '../../../shared/operation-contract';
import type { SiteRegistry } from './index';
import { SAMPLE, refused, seedCommittee, seedCommitteeAndPlaces, written } from './controller-support';

export function createDistrict(registry: SiteRegistry): WriteOperation {
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

export function relabelDistrict(registry: SiteRegistry): WriteOperation {
  return {
    kind: 'write',
    name: 'sites.relabelDistrict',
    method: 'PATCH',
    path: '/districts/:districtId',
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
