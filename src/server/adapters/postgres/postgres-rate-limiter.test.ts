import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../shared/clock';
import type { RateLimit } from '../../shared/rate-limiter';
import { PostgresSlidingWindowRateLimiter } from './postgres-rate-limiter';
import { createTestDatabase } from '../../test-support/postgres-test-database';
import type { Clock } from '../../shared/clock';
import type { RateLimiter } from '../../shared/rate-limiter';

/**
 * The contract the RateLimiter adapter keeps (ADR-15, ADR-21). The same expected values held for the in-memory
 * limiter until it was deleted (ADR-21).
 */
const ADAPTERS: readonly (readonly [string, (clock: Clock) => Promise<RateLimiter>])[] = [
  [' over PostgreSQL', async (clock) => new PostgresSlidingWindowRateLimiter((await createTestDatabase()).database, clock)],
];

const THREE_PER_MINUTE: RateLimit = { maximumAttempts: 3, windowMilliseconds: 60_000 };

describe.each(ADAPTERS)('sliding-window rate limiter%s', (_adapter, newLimiter) => {
async function limiterAt(instant: string) {
  const clock = new FixedClock(new Date(instant));
  return { clock, limiter: await newLimiter(clock) };
}

  it('admits attempts up to the limit and refuses the next one inside the window', async () => {
    const { limiter } = await limiterAt('2026-11-07T10:00:00Z');
    const verdicts = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      verdicts.push(await limiter.attempt('phone/+201', THREE_PER_MINUTE));
    }
    expect(verdicts).toEqual(['admitted', 'admitted', 'admitted', 'over limit']);
  });

  it('admits again once the oldest attempt has left the window', async () => {
    const { clock, limiter } = await limiterAt('2026-11-07T10:00:00Z');
    await limiter.attempt('key', THREE_PER_MINUTE);
    clock.advanceByMilliseconds(30_000);
    await limiter.attempt('key', THREE_PER_MINUTE);
    await limiter.attempt('key', THREE_PER_MINUTE);
    clock.advanceByMilliseconds(30_001);
    expect(await limiter.attempt('key', THREE_PER_MINUTE)).toBe('admitted');
    expect(await limiter.attempt('key', THREE_PER_MINUTE)).toBe('over limit');
  });

  it('does not count a refused attempt, so a flood never extends the refusal', async () => {
    const { clock, limiter } = await limiterAt('2026-11-07T10:00:00Z');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await limiter.attempt('key', THREE_PER_MINUTE);
    }
    clock.advanceByMilliseconds(60_001);
    expect(await limiter.attempt('key', THREE_PER_MINUTE)).toBe('admitted');
  });

  it('keeps keys independent', async () => {
    const { limiter } = await limiterAt('2026-11-07T10:00:00Z');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await limiter.attempt('one', THREE_PER_MINUTE);
    }
    expect(await limiter.attempt('two', THREE_PER_MINUTE)).toBe('admitted');
  });
});
