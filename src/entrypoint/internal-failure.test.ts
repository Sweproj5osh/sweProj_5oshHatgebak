import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryOperation, WriteOperation } from '../shared/operation-contract';
import { INTERNAL_ERROR } from './internal-failure';
import { telemetryRequest, testApplication, writeRequest } from './test-helpers';

const SECRET_CAUSE = 'connection to 10.0.0.7 refused: password for sayes_application rejected';

const explodingWrite: WriteOperation = {
  kind: 'write',
  name: 'test.explodes',
  method: 'POST',
  path: '/test/explodes',
  allowedRoles: ['chair'],
  bodySchema: { fields: {} },
  examples: { valid: {}, invalid: [] },
  async handle() {
    throw new Error(SECRET_CAUSE);
  },
};

const explodingReading: TelemetryOperation = {
  kind: 'telemetry',
  name: 'test.readingExplodes',
  method: 'POST',
  path: '/test/reading-explodes',
  allowedRoles: ['attendant'],
  bodySchema: { fields: {} },
  examples: { valid: {}, invalid: [] },
  async handle() {
    throw new Error(SECRET_CAUSE);
  },
};

describe('a failed handler never leaks its cause to the client', () => {
  const serverLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  afterEach(() => serverLog.mockClear());

  it.each([
    { kind: 'write', send: () => writeRequest('/test/explodes', 'chair', 'request-0001', {}) },
    { kind: 'telemetry', send: () => telemetryRequest('/test/reading-explodes', 'attendant', {}) },
  ])('$kind: the client gets a plain internal error and a correlation id; the cause goes to the server log', async ({ send }) => {
    const { handle } = testApplication({ additionalOperations: [explodingWrite, explodingReading] });
    const response = await handle(send());
    const body = response.body as { error: string; correlationId: string };
    expect(response.status).toBe(500);
    expect(body.error).toBe(INTERNAL_ERROR);
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.7');
    const logged = serverLog.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain(body.correlationId);
    expect(logged).toContain(SECRET_CAUSE);
  });
});
