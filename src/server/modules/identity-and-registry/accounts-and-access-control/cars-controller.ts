import { refuse, respond, type ReadOperation, type WriteOperation } from '../../../shared/operation-contract';
import type { AccountsAndAccessControl, CarRefusal } from './index';
import { seedPerson } from './controller-support';

/** A driver saves a car; the audit entry keeps the car reference in place of the plate (P2). */
export function addCar(accounts: AccountsAndAccessControl): WriteOperation {
  return {
    kind: 'write',
    name: 'personalData.addCar',
    method: 'POST',
    path: '/cars',
    allowedRoles: ['driver'],
    bodySchema: { fields: { plate: 'string' } },
    audit: { replace: { plate: 'carRef' } },
    examples: { valid: { plate: 'ABC 123' }, invalid: {} },
    fixture: (database) => seedPerson(database, 'driver-1', 'driver', '+201022222222'),
    async handle({ actor, body }) {
      const added = await accounts.personalData.addCar(actor.personId, String(body['plate']));
      if (!added.ok) {
        return { response: refuse(CAR_REFUSAL_STATUS[added.error], added.error) };
      }
      return { response: respond(201, { carRef: added.value }), audit: { references: { carRef: added.value } } };
    },
  };
}

const CAR_REFUSAL_STATUS: Readonly<Record<CarRefusal, number>> = { 'not a driver': 403, 'invalid plate': 400 };

/** A driver's own cars, for the driver's own screen: one's own data, so nothing for accountability to gain (P9). */
export function readOwnCars(accounts: AccountsAndAccessControl): ReadOperation {
  return {
    kind: 'read',
    name: 'personalData.ownCars',
    method: 'GET',
    path: '/cars',
    allowedRoles: ['driver'],
    scope: 'own',
    logged: false,
    async handle({ actor }) {
      return { response: respond(200, { cars: await accounts.personalData.ownCars(actor.personId) }) };
    },
  };
}

/**
 * An inspector's (or committee member's) plate look-up at a site in their scope (Rule F, P9): a logged read, so the
 * pipeline requires a request id and writes the one audit entry naming the reader, the car reference and the owner.
 */
export function lookUpPlate(accounts: AccountsAndAccessControl): ReadOperation {
  return {
    kind: 'read',
    name: 'personalData.lookUpPlate',
    method: 'GET',
    path: '/cars/:carRef/plate',
    allowedRoles: ['inspector', 'member', 'chair'],
    scope: 'staff-scoped',
    logged: true,
    audit: { touchesPersonalData: true },
    async handle({ actor, query }) {
      const served = await accounts.personalData.readPlate({
        carRef: query['carRef'] ?? '',
        siteId: query['siteId'] ?? '',
        reader: actor.personId,
        purpose: 'inspector look-up',
      });
      if (!served.ok) {
        return { response: refuse(served.error === 'refused' ? 403 : 404, served.error) };
      }
      const { plate, ownerRef, districtId } = served.value;
      return {
        response: respond(200, { plate }),
        audit: districtId === undefined ? { subjectPersonIds: [ownerRef] } : { subjectPersonIds: [ownerRef], districtId },
      };
    },
  };
}
