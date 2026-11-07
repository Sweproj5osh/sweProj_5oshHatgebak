import { describe, expect, it } from 'vitest';
import { findTimestampFields, looksLikeIso8601, looksLikeTimestampKey } from './timestamp-fields';

describe('looksLikeTimestampKey', () => {
  it.each(['openedAt', 'closedAt', 'at', 'entryTime', 'startDate', 'timestamp', 'exit_time'])(
    'flags %s',
    (key) => expect(looksLikeTimestampKey(key)).toBe(true),
  );

  it.each(['closed_at', 'created_at', 'paid_at', 'CLOSED_AT', 'ClosedAT', 'AT', 'paidAt', 'PAID_TIME', 'epoch', 'startEpoch', 'start_epoch', 'DATE'])(
    'flags %s whatever the case or the word separator',
    (key) => expect(looksLikeTimestampKey(key)).toBe(true),
  );

  it.each(['siteId', 'format', 'seat', 'chat', 'reason', 'plateCount', 'attendantId', 'FORMAT', 'heat_map'])(
    'leaves %s alone',
    (key) => expect(looksLikeTimestampKey(key)).toBe(false),
  );
});

describe('looksLikeIso8601', () => {
  it.each(['2026-11-04', '2026-11-04T10:00:00Z', '2026-11-04T10:00:00.123+02:00', '2026-11-04 10:00'])(
    'recognises %s',
    (value) => expect(looksLikeIso8601(value)).toBe(true),
  );

  it.each(['site-12', 'ENTRY-2026', 42, null, '10:00'])('ignores %s', (value) =>
    expect(looksLikeIso8601(value)).toBe(false),
  );
});

describe('findTimestampFields', () => {
  it('returns the dotted path of every offending key or value, at any depth', () => {
    const body = { siteId: 's1', car: { plate: 'x', enteredAt: 1 }, notes: [{ text: '2026-11-04T10:00:00Z' }] };
    expect(findTimestampFields(body)).toEqual(['car.enteredAt', 'notes[0].text']);
  });

  it('catches an epoch number under a snake_case or upper-case time name', () => {
    expect(findTimestampFields({ paid_at: 1762538400 })).toEqual(['paid_at']);
    expect(findTimestampFields({ CLOSED_AT: 1762538400000 })).toEqual(['CLOSED_AT']);
  });

  it('returns nothing for a clean body', () => {
    expect(findTimestampFields({ siteId: 's1', entryCode: 'ENTRY-1' })).toEqual([]);
  });
});
