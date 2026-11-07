import { describe, expect, it } from 'vitest';
import { FixedClock } from '../shared/clock';
import type { TelemetryOperation } from '../shared/operation-contract';
import { TELEMETRY_READINGS_PER_PERSON, TOO_MANY_ATTEMPTS } from './rate-limits';
import { telemetryRequest, testApplication, tokenFor } from './test-helpers';

const READINGS_TABLE = 'test_location_readings';
const A_READING = { latitude: 30.0444, longitude: 31.2357 };

/** Stands in for Lino's location reading: a measurement, written to the module's own table, never audited (P7). */
const recordLocation: TelemetryOperation = {
  kind: 'telemetry',
  name: 'attendance.recordLocation',
  method: 'POST',
  path: '/attendance/locations',
  allowedRoles: ['attendant'],
  bodySchema: { fields: { latitude: 'number', longitude: 'number' } },
  examples: { valid: A_READING, invalid: { latitude: 'north' } },
  async handle(context) {
    if (context.body['latitude'] === 0) {
      throw new Error('the reading could not be stored');
    }
    await context.transaction.insert(READINGS_TABLE, `${context.actor.personId}/${Date.now()}/${Math.random()}`, {
      attendantId: context.actor.personId,
      ...context.body,
    });
  },
};

function application() {
  const clock = new FixedClock(new Date('2026-11-07T10:00:00Z'));
  return { clock, ...testApplication({ clock, additionalOperations: [recordLocation] }) };
}

describe('telemetry operations (P7): measurements are not actions', () => {
  it('answers 204 with no body, writes the reading through the unit of work and leaves no audit entry', async () => {
    const { handle, audit, database } = application();
    const response = await handle(telemetryRequest('/attendance/locations', 'attendant', A_READING));
    expect(response).toEqual({ status: 204, body: undefined });
    expect(await database.list(READINGS_TABLE)).toHaveLength(1);
    expect(await audit.readByScope({ personId: 'chair-1', role: 'chair' })).toHaveLength(0);
  });

  it('needs no request id, but still needs a token with an allowed role', async () => {
    const { handle } = application();
    const request = telemetryRequest('/attendance/locations', 'attendant', A_READING);
    expect(request.headers['x-request-id']).toBeUndefined();
    const noToken = await handle({ ...request, headers: {} });
    const wrongRole = await handle({ ...request, headers: { authorization: `Bearer ${tokenFor('driver')}` } });
    expect([noToken.status, wrongRole.status]).toEqual([401, 403]);
  });

  it('validates the body and refuses a timestamp from the phone', async () => {
    const { handle, database } = application();
    const badBody = await handle(telemetryRequest('/attendance/locations', 'attendant', { latitude: 'north', longitude: 31 }));
    const withTime = await handle(telemetryRequest('/attendance/locations', 'attendant', { ...A_READING, measuredAt: 1 }));
    expect([badBody.status, withTime.status]).toEqual([400, 400]);
    expect(await database.list(READINGS_TABLE)).toHaveLength(0);
  });

  it(`admits ${TELEMETRY_READINGS_PER_PERSON.maximumAttempts} reading per person per ${TELEMETRY_READINGS_PER_PERSON.windowMilliseconds / 1000} seconds, then 429`, async () => {
    const { handle, clock } = application();
    const first = await handle(telemetryRequest('/attendance/locations', 'attendant', A_READING));
    const second = await handle(telemetryRequest('/attendance/locations', 'attendant', A_READING));
    const anotherPerson = await handle({
      ...telemetryRequest('/attendance/locations', 'attendant', A_READING),
      headers: { authorization: `Bearer ${tokenFor('attendant', { personId: 'attendant-2' })}` },
    });
    clock.advanceByMilliseconds(TELEMETRY_READINGS_PER_PERSON.windowMilliseconds + 1);
    const afterTheWindow = await handle(telemetryRequest('/attendance/locations', 'attendant', A_READING));
    expect([first.status, second.status, anotherPerson.status, afterTheWindow.status]).toEqual([204, 429, 204, 204]);
    expect(second.body).toEqual({ error: TOO_MANY_ATTEMPTS });
  });

  it('rolls the unit of work back and answers 500 when the handler throws', async () => {
    const { handle, database } = application();
    const response = await handle(telemetryRequest('/attendance/locations', 'attendant', { latitude: 0, longitude: 31 }));
    expect(response.status).toBe(500);
    expect(await database.list(READINGS_TABLE)).toHaveLength(0);
  });
});
