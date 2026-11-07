import { describe, expect, it } from 'vitest';
import { refuse, respond, type ReadOperation } from '../shared/operation-contract';
import { REQUEST_ID_HEADER } from '../shared/request-id';
import { loggedReadRequest, readRequest, testApplication, tokenFor } from './test-helpers';

const CARS_TABLE = 'test_cars';

/** Stands in for Lino's plate read (Rule F): a role-checked, logged join of a car reference to its plate. */
const readPlate: ReadOperation = {
  kind: 'read',
  name: 'personalData.readPlate',
  method: 'GET',
  path: '/plates',
  allowedRoles: ['inspector', 'chair'],
  scope: 'own',
  logged: true,
  audit: { touchesPersonalData: true },
  async handle(context) {
    const carRef = context.query['carRef'] ?? '';
    const car = await context.database.read<{ plate: string; ownerRef: string }>(CARS_TABLE, carRef);
    if (car === undefined) {
      return { response: refuse(404, 'no such car') };
    }
    if (car.plate === 'EXPLODE') {
      throw new Error('the personal-data store is unreachable');
    }
    return { response: respond(200, { plate: car.plate }), audit: { subjectPersonIds: [car.ownerRef] } };
  },
};

/** A driver's own cars: own data, so nothing for accountability to gain (P9). */
const readOwnCars: ReadOperation = {
  kind: 'read',
  name: 'personalData.readOwnCars',
  method: 'GET',
  path: '/my/cars',
  allowedRoles: ['driver'],
  scope: 'own',
  async handle(context) {
    const cars = await context.database.list<{ ownerRef: string }>(CARS_TABLE);
    return { response: respond(200, { count: cars.filter((car) => car.ownerRef === context.actor.personId).length }) };
  },
};

async function application() {
  const composed = testApplication({ additionalOperations: [readPlate, readOwnCars] });
  await composed.database.insert(CARS_TABLE, 'car-7', { plate: 'ABC 123', ownerRef: 'driver-1' });
  await composed.database.insert(CARS_TABLE, 'car-8', { plate: 'EXPLODE', ownerRef: 'driver-2' });
  return composed;
}

describe('logged reads (P9)', () => {
  it('requires a request id', async () => {
    const { handle, audit } = await application();
    const response = await handle(readRequest('/plates', tokenFor('inspector'), { carRef: 'car-7' }));
    expect(response.status).toBe(400);
    expect(String((response.body as { error: string }).error)).toContain(REQUEST_ID_HEADER);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
  });

  it('answers the read and leaves exactly one audit entry: operation, actor, request id, the reference read, the subject', async () => {
    const { handle, audit } = await application();
    const response = await handle(loggedReadRequest('/plates', 'inspector', 'request-0001', { carRef: 'car-7' }));
    expect(response).toEqual({ status: 200, body: { plate: 'ABC 123' } });
    const entries = await audit.readByScope({ personId: 'chair-1', role: 'chair' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      personId: 'inspector-1',
      role: 'inspector',
      operation: 'personalData.readPlate',
      requestId: 'request-0001',
      input: { carRef: 'car-7' },
      subjectPersonIds: ['driver-1'],
    });
    expect(JSON.stringify(entries[0])).not.toContain('ABC 123');
  });

  it('applies the declared redaction to the query it logs', async () => {
    const redacted: ReadOperation = { ...readPlate, name: 'test.redactedRead', path: '/redacted', audit: { omit: ['carRef'] } };
    const { handle, audit, database } = testApplication({ additionalOperations: [redacted] });
    await database.insert(CARS_TABLE, 'car-7', { plate: 'ABC 123', ownerRef: 'driver-1' });
    await handle(loggedReadRequest('/redacted', 'chair', 'request-0001', { carRef: 'car-7', page: '1' }));
    const [entry] = await audit.readByScope({ personId: 'chair-1', role: 'chair' });
    expect(entry?.input).toEqual({ page: '1' });
  });

  it('leaves no entry when the handler refuses or throws', async () => {
    const { handle, audit } = await application();
    const refused = await handle(loggedReadRequest('/plates', 'inspector', 'request-0001', { carRef: 'car-none' }));
    const crashed = await handle(loggedReadRequest('/plates', 'inspector', 'request-0002', { carRef: 'car-8' }));
    expect([refused.status, crashed.status]).toEqual([404, 500]);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
  });

  it('a read that is not logged needs no request id, sees the committed rows and leaves no entry', async () => {
    const { handle, audit } = await application();
    const response = await handle(readRequest('/my/cars', tokenFor('driver')));
    expect(response).toEqual({ status: 200, body: { count: 1 } });
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
  });
});
