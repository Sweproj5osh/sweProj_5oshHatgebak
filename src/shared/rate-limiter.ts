/** How many attempts one key may make inside one sliding window. */
export interface RateLimit {
  readonly maximumAttempts: number;
  readonly windowMilliseconds: number;
}

export type RateLimitVerdict = 'admitted' | 'over limit';

/**
 * Port: counts attempts per key inside a sliding window (P3, P7). Adapters implement it in memory for tests and over
 * shared storage for the stateless server copies. A refused attempt is not counted, so a flood never extends the
 * refusal beyond the window.
 */
export interface RateLimiter {
  /** Records one attempt under `key` when it fits inside `limit`, and says whether it did. */
  attempt(key: string, limit: RateLimit): Promise<RateLimitVerdict>;
}
