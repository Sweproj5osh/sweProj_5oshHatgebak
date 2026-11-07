import { describe, expect, it } from 'vitest';
import { validateBody, type BodySchema } from './body-schema';

const cairoNoon = { year: 2026, month: 11, day: 7, hour: 12, minute: 0 };
const tahrir = { latitude: 30.0444, longitude: 31.2357 };

function problemsOf(schema: BodySchema, body: unknown): string[] {
  const result = validateBody(schema, body);
  return result.ok ? [] : result.error;
}

describe('body schema: scalars (unchanged)', () => {
  const schema: BodySchema = { fields: { siteId: 'string', capacity: 'number', assisted: 'boolean' } };

  it('accepts a body that matches', () => {
    expect(validateBody(schema, { siteId: 's-1', capacity: 5, assisted: false }).ok).toBe(true);
  });

  it('names every missing, mistyped and unknown field', () => {
    expect(problemsOf(schema, { capacity: 'five', assisted: true, extra: 1 })).toEqual([
      'field "siteId" is required',
      'field "capacity" must be a number',
      'field "extra" is not part of this operation',
    ]);
  });

  it('refuses anything that is not a JSON object', () => {
    expect(problemsOf(schema, [1])).toEqual(['body must be a JSON object']);
  });
});

describe('body schema: list of <kind> (P6)', () => {
  it('accepts a list of strings and a list of numbers', () => {
    const schema: BodySchema = { fields: { tags: { list: 'string' }, hours: { list: 'number' } } };
    expect(validateBody(schema, { tags: ['a', 'b'], hours: [8, 20] }).ok).toBe(true);
  });

  it('accepts an empty list', () => {
    expect(validateBody({ fields: { tags: { list: 'string' } } }, { tags: [] }).ok).toBe(true);
  });

  it('rejects a value that is not a list, and names the element that has the wrong kind', () => {
    const schema: BodySchema = { fields: { tags: { list: 'string' }, hours: { list: 'number' } } };
    expect(problemsOf(schema, { tags: 'a', hours: [8, 'twenty'] })).toEqual([
      'field "tags" must be a list of string',
      'field "hours[1]" must be a number',
    ]);
  });

  it('accepts a list of points', () => {
    const schema: BodySchema = { fields: { outline: { list: 'point' } } };
    expect(validateBody(schema, { outline: [tahrir, { latitude: 30.05, longitude: 31.24 }] }).ok).toBe(true);
  });

  it.each([
    { reason: 'missing longitude', point: { latitude: 30.0 } },
    { reason: 'an extra key', point: { ...tahrir, altitude: 20 } },
    { reason: 'a string coordinate', point: { latitude: '30.0', longitude: 31.2 } },
    { reason: 'a latitude beyond 90', point: { latitude: 91, longitude: 31.2 } },
    { reason: 'a longitude beyond 180', point: { latitude: 30, longitude: 181 } },
    { reason: 'not an object', point: [30, 31] },
  ])('rejects a malformed point with $reason', ({ point }) => {
    expect(problemsOf({ fields: { outline: { list: 'point' } } }, { outline: [tahrir, point] })).toEqual([
      'field "outline[1]" must be a point: { latitude, longitude } numbers within -90..90 and -180..180',
    ]);
  });
});

describe('body schema: localDateTime (P6)', () => {
  const schema: BodySchema = { fields: { closesFrom: 'localDateTime' } };

  it('accepts year, month, day, hour and minute as integers', () => {
    expect(validateBody(schema, { closesFrom: cairoNoon }).ok).toBe(true);
  });

  it.each([
    { reason: 'seconds', value: { ...cairoNoon, second: 0 } },
    { reason: 'a zone', value: { ...cairoNoon, zone: 'Africa/Cairo' } },
    { reason: 'a missing minute', value: { year: 2026, month: 11, day: 7, hour: 12 } },
    { reason: 'a fractional hour', value: { ...cairoNoon, hour: 12.5 } },
    { reason: 'month 13', value: { ...cairoNoon, month: 13 } },
    { reason: 'day 0', value: { ...cairoNoon, day: 0 } },
    { reason: 'hour 24', value: { ...cairoNoon, hour: 24 } },
    { reason: 'minute 60', value: { ...cairoNoon, minute: 60 } },
    { reason: 'an ISO string', value: '2026-11-07T12:00' },
  ])('rejects $reason', ({ value }) => {
    expect(problemsOf(schema, { closesFrom: value })).toEqual([
      'field "closesFrom" must be a localDateTime: { year, month, day, hour, minute } integers in Cairo local time',
    ]);
  });
});
