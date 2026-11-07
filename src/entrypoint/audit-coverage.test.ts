import { describe, expect, it } from 'vitest';
import { refuse, respond, type PublicWriteOperation, type ReadOperation, type TelemetryOperation, type WriteOperation } from '../shared/operation-contract';
import type { InMemoryApplication } from './composition';
import type { HttpRequest } from './http';
import { publicRequest, telemetryRequest, testApplication, writeRequest } from './test-helpers';

type AuditedWrite = WriteOperation | PublicWriteOperation;

/**
 * Fitness function F5 (task Z9): every write and public operation in the composed registry leaves exactly one audit
 * row when called with a valid payload and zero rows when called with an invalid one. An operation that needs rows to
 * exist first seeds them through its `fixture` (P26 Q10); F5 runs the fixture before the sample request.
 */
describe('F5 audit coverage over every write and public operation in the composed registry', () => {
  const { registry } = testApplication();
  const audited: readonly AuditedWrite[] = [...registry.writes(), ...registry.publicWrites()];

  it('has at least one write operation registered', () => {
    expect(audited.length).toBeGreaterThan(0);
    console.log(`Z9 report: operations covered ${audited.length} / ${audited.length}`);
  });

  for (const operation of audited) {
    it(`${operation.name}: a valid payload leaves exactly one audit row`, async () => {
      await expectOneAuditRowForTheValidExample(testApplication(), operation);
    });

    it(`${operation.name}: an invalid payload leaves zero audit rows`, async () => {
      await expectNoAuditRowForTheInvalidExample(testApplication(), operation);
    });
  }
});

/** Rule F: showing personal data is a logged join, so a read that declares it touches personal data must be logged (P9). */
describe('F5: every read that touches personal data is a logged read', () => {
  const { registry } = testApplication();

  it('holds for every read in the composed registry', () => {
    expect(unloggedReadsOfPersonalData(registry.reads())).toEqual([]);
  });

  it('names a read that touches personal data without being logged', () => {
    const unlogged: ReadOperation = {
      kind: 'read',
      name: 'bad.readPlate',
      method: 'GET',
      path: '/bad/plates',
      allowedRoles: ['chair'],
      scope: 'own',
      audit: { touchesPersonalData: true },
      async handle() {
        return { response: respond(200, {}) };
      },
    };
    expect(unloggedReadsOfPersonalData([unlogged])).toEqual(['bad.readPlate']);
  });
});

function unloggedReadsOfPersonalData(reads: readonly ReadOperation[]): string[] {
  return reads.filter((read) => read.audit?.touchesPersonalData === true && read.logged !== true).map((read) => read.name);
}

/** Telemetry is left out of the one-entry rule on purpose (P7): a measurement is not an action, so it leaves no entry. */
describe('F5 ignores telemetry operations explicitly: a telemetry post leaves no audit entry', () => {
  const { registry } = testApplication();
  const reading: TelemetryOperation = {
    kind: 'telemetry',
    name: 'test.reading',
    method: 'POST',
    path: '/test/readings',
    allowedRoles: ['attendant'],
    bodySchema: { fields: { value: 'number' } },
    examples: { valid: { value: 1 }, invalid: {} },
    async handle(context) {
      await context.transaction.insert('test_readings', String(Math.random()), context.body);
    },
  };

  for (const operation of [...registry.telemetry(), reading]) {
    it(`${operation.name}: a valid reading is accepted with 204 and leaves zero audit rows`, async () => {
      const application = testApplication({ additionalOperations: [reading] });
      await operation.fixture?.(application.database);
      const response = await application.handle(telemetryRequest(operation.path, firstAllowedRole(operation), operation.examples.valid));
      expect(response.status).toBe(204);
      expect(await application.audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
    });
  }
});

describe('F5 runs an operation\'s fixture before its sample request', () => {
  const SEEDED_TABLE = 'test_seeded_rows';
  const needsASeededRow: WriteOperation = {
    kind: 'write',
    name: 'test.needsSeededRow',
    method: 'POST',
    path: '/test/needs-seeded-row',
    allowedRoles: ['chair'],
    bodySchema: { fields: { rowKey: 'string' } },
    examples: { valid: { rowKey: 'seed-1' }, invalid: {} },
    async fixture(database) {
      await database.insert(SEEDED_TABLE, 'seed-1', { planted: true });
    },
    async handle(context) {
      const row = await context.transaction.read(SEEDED_TABLE, String(context.body['rowKey']));
      return { response: row === undefined ? refuse(404, 'no such row') : respond(200, row) };
    },
  };

  it('the handler finds the seeded row and leaves one audit entry', async () => {
    const application = testApplication({ additionalOperations: [needsASeededRow] });
    await expectOneAuditRowForTheValidExample(application, needsASeededRow);
  });
});

async function expectOneAuditRowForTheValidExample(application: InMemoryApplication, operation: AuditedWrite): Promise<void> {
  await fixtureOf(application, operation)?.(application.database);
  const response = await application.handle(sampleRequest(operation, 'request-valid-1', operation.examples.valid));
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(400);
  const rows = await application.audit.readByScope({ personId: 'chair-1', role: 'chair' });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.operation).toBe(operation.name);
}

async function expectNoAuditRowForTheInvalidExample(application: InMemoryApplication, operation: AuditedWrite): Promise<void> {
  const response = await application.handle(sampleRequest(operation, 'request-invalid-1', operation.examples.invalid));
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(await application.audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
}

/** The fixture of the application that answers the request: a fixture may close over that composition's own state (a module's price list, for example). */
function fixtureOf(application: InMemoryApplication, operation: AuditedWrite): AuditedWrite['fixture'] {
  const composedHere = application.registry.find(operation.method, operation.path);
  return composedHere !== undefined && 'fixture' in composedHere ? composedHere.fixture : undefined;
}

function sampleRequest(operation: AuditedWrite, requestId: string, body: unknown): HttpRequest {
  if (operation.kind === 'public') {
    return publicRequest(operation.path, requestId, body);
  }
  return writeRequest(operation.path, firstAllowedRole(operation), requestId, body);
}

function firstAllowedRole(operation: WriteOperation | TelemetryOperation) {
  const role = operation.allowedRoles[0];
  if (role === undefined) {
    throw new Error(`${operation.name} allows no role, so nobody can ever call it`);
  }
  return role;
}
