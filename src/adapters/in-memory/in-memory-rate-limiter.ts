import type { Clock } from '../../shared/clock';
import type { RateLimit, RateLimiter, RateLimitVerdict } from '../../shared/rate-limiter';

/** One process, one map of attempt times per key; the window slides with the server clock. */
export class InMemorySlidingWindowRateLimiter implements RateLimiter {
  private readonly attemptTimesByKey = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  async attempt(key: string, limit: RateLimit): Promise<RateLimitVerdict> {
    const now = this.clock.now().getTime();
    const recent = this.attemptsSince(key, now - limit.windowMilliseconds);
    if (recent.length >= limit.maximumAttempts) {
      return 'over limit';
    }
    this.attemptTimesByKey.set(key, [...recent, now]);
    return 'admitted';
  }

  private attemptsSince(key: string, windowStart: number): number[] {
    return (this.attemptTimesByKey.get(key) ?? []).filter((time) => time > windowStart);
  }
}
