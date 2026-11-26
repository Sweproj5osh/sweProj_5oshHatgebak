import type { Clock } from '../../shared/clock';
import type { RateLimit, RateLimiter, RateLimitVerdict } from '../../shared/rate-limiter';
import type { PostgresDatabase } from './postgres-database';

/**
 * The sliding window over `foundation.rate_limit_attempts`, shared by every server copy (ADR-15). One key is counted
 * at a time under a transaction-scoped advisory lock; attempts older than the window are dropped; a refused attempt is
 * not recorded. Every time comes from the server clock, never from the database.
 */
export class PostgresSlidingWindowRateLimiter implements RateLimiter {
  constructor(
    private readonly database: PostgresDatabase,
    private readonly clock: Clock,
  ) {}

  async attempt(key: string, limit: RateLimit): Promise<RateLimitVerdict> {
    const now = this.clock.now();
    const windowStart = new Date(now.getTime() - limit.windowMilliseconds);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      await client.query('DELETE FROM foundation.rate_limit_attempts WHERE attempt_key = $1 AND attempted_at <= $2', [key, windowStart]);
      const counted = await client.query<{ attempts: string }>('SELECT count(*) AS attempts FROM foundation.rate_limit_attempts WHERE attempt_key = $1', [key]);
      const verdict: RateLimitVerdict = Number(counted.rows[0]?.attempts ?? 0) >= limit.maximumAttempts ? 'over limit' : 'admitted';
      if (verdict === 'admitted') {
        await client.query('INSERT INTO foundation.rate_limit_attempts (attempt_key, attempted_at) VALUES ($1, $2)', [key, now]);
      }
      await client.query('COMMIT');
      return verdict;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
