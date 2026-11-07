import { describe, expect, it } from 'vitest';
import { respond, type AuditDetail, type AuditRedaction, type WriteOperation } from '../shared/operation-contract';
import { testApplication, writeRequest } from './test-helpers';

const CAR_BODY = { plate: 'ABC 123', colour: 'red' };

function addCar(audit: AuditRedaction | undefined, detail: AuditDetail = {}): WriteOperation {
  return {
    kind: 'write',
    name: 'test.addCar',
    method: 'POST',
    path: '/test/cars',
    allowedRoles: ['driver'],
    bodySchema: { fields: { plate: 'string', colour: 'string' } },
    examples: { valid: CAR_BODY, invalid: {} },
    ...(audit === undefined ? {} : { audit }),
    async handle() {
      return { response: respond(201, {}), audit: detail };
    },
  };
}

async function auditInputAfter(operation: WriteOperation) {
  const { handle, audit } = testApplication({ additionalOperations: [operation] });
  const response = await handle(writeRequest(operation.path, 'driver', 'request-0001', CAR_BODY));
  const [entry] = await audit.readByScope({ personId: 'chair-1', role: 'chair' });
  return { response, entry };
}

describe('declared audit redaction (P2, ADR-14)', () => {
  it('omit: the stored entry never contains the omitted value', async () => {
    const { entry } = await auditInputAfter(addCar({ omit: ['plate'] }));
    expect(entry?.input).toEqual({ colour: 'red' });
    expect(JSON.stringify(entry)).not.toContain('ABC 123');
  });

  it('replace: the body field is dropped and the handler\'s reference is written in its place', async () => {
    const { entry } = await auditInputAfter(addCar({ replace: { plate: 'carRef' } }, { references: { carRef: 'car-7' } }));
    expect(entry?.input).toEqual({ colour: 'red', carRef: 'car-7' });
    expect(JSON.stringify(entry)).not.toContain('ABC 123');
  });

  it('replace without the promised reference is a programming error: 500, rolled back, no entry', async () => {
    const { response, entry } = await auditInputAfter(addCar({ replace: { plate: 'carRef' } }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).toContain('carRef');
    expect(entry).toBeUndefined();
  });

  it('no rule: the body is copied whole, as before', async () => {
    const { entry } = await auditInputAfter(addCar(undefined));
    expect(entry?.input).toEqual(CAR_BODY);
  });
});
