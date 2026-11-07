import { describe, expect, it } from 'vitest';
import { isWellFormedRequestId } from '../../shared/request-id';
import { randomRequestId, RequestIdKeeper } from './request-id';

function countingKeeper() {
  let serial = 0;
  return new RequestIdKeeper(() => `request-${String((serial += 1)).padStart(4, '0')}`);
}

describe('request ids: generated once per tap, kept across retries (Rule H)', () => {
  it('gives the same id to a retry of the same input until the server answers, then a new id', () => {
    const keeper = countingKeeper();

    const first = keeper.idFor('01012345678');
    const retry = keeper.idFor('01012345678');
    keeper.settle();
    const nextTap = keeper.idFor('01012345678');

    expect([first, retry, nextTap]).toEqual(['request-0001', 'request-0001', 'request-0002']);
  });

  it('gives a different input a new id even while the earlier one is unanswered, so an old request is never resent in its place', () => {
    const keeper = countingKeeper();

    const lost = keeper.idFor('site-1\u0000car-a\u0000entry-site-1');
    const other = keeper.idFor('site-2\u0000car-a\u0000entry-site-2');

    expect(lost).toBe('request-0001');
    expect(other).toBe('request-0002');
    expect(keeper.pendingId()).toBe('request-0002');
  });

  it('knows no pending id before the first tap and none after the answer', () => {
    const keeper = countingKeeper();

    expect(keeper.pendingId()).toBeUndefined();
    keeper.idFor('anything');
    expect(keeper.pendingId()).toBe('request-0001');
    keeper.settle();
    expect(keeper.pendingId()).toBeUndefined();
  });

  it('generates ids the entry point accepts, distinct on every call', () => {
    const ids = new Set(Array.from({ length: 50 }, randomRequestId));

    expect(ids.size).toBe(50);
    expect([...ids].every(isWellFormedRequestId)).toBe(true);
  });
});
