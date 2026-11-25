import type pg from 'pg';
import type { ResponseStore, StoredResponse } from '../../http/repeatable-writes/response-store';
import type { Clock } from '../../shared/clock';
import type { Queryable } from './postgres-database';

interface ResponseRow extends pg.QueryResultRow {
  readonly status: number;
  readonly body: unknown;
  readonly body_absent: boolean;
  readonly body_hash: string;
}

/**
 * The first answer of every committed write, with the hash of the body that produced it (Rule H, P19), in
 * `foundation.write_responses`. The answer comes back as it was stored, an absent body included.
 */
export class PostgresResponseStore implements ResponseStore {
  constructor(
    private readonly committed: Queryable,
    private readonly clock: Clock,
  ) {}

  async find(responseKey: string): Promise<StoredResponse | undefined> {
    const result = await this.committed.query<ResponseRow>(
      'SELECT status, body, body IS NULL AS body_absent, body_hash FROM foundation.write_responses WHERE response_key = $1',
      [responseKey],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return { response: { status: row.status, body: row.body_absent ? undefined : row.body }, bodyHash: row.body_hash };
  }

  async save(responseKey: string, stored: StoredResponse): Promise<void> {
    await this.committed.query(
      `INSERT INTO foundation.write_responses (response_key, status, body, body_hash, stored_at) VALUES ($1, $2, $3::json, $4, $5)
       ON CONFLICT (response_key) DO NOTHING`,
      [responseKey, stored.response.status, stored.response.body === undefined ? null : JSON.stringify(stored.response.body), stored.bodyHash, this.clock.now()],
    );
  }
}
