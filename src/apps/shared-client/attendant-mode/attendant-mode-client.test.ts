import { describe, expect, it } from 'vitest';
import type { RequestId } from '../../../shared/request-id';
import { InMemoryAttendantModeApi } from '../../test-support/in-memory-attendant-mode-api';
import { ServerTransportError } from '../server-call';
import { AttendantModeRefusedError, type AttendantModeApi } from './attendant-mode-api';
import { AttendantModeClient } from './attendant-mode-client';

const SITE_ID = 'site-12';
const RIGHT_CODE = `attendant-${SITE_ID}`;

function buildClient(api: AttendantModeApi = new InMemoryAttendantModeApi()) {
  let serial = 1;
  return new AttendantModeClient({ api, createRequestId: () => `d5-req-${String(serial++).padStart(4, '0')}` });
}

/** Lets the server apply the clock-in, then loses the answer when the plan says so, the way airplane mode does. */
class AnswerLosingApi implements AttendantModeApi {
  readonly seenRequestIds: RequestId[] = [];

  constructor(
    private readonly inner: AttendantModeApi,
    private readonly plan: boolean[],
  ) {}

  async clockIn(siteCode: string, requestId: RequestId) {
    this.seenRequestIds.push(requestId);
    const result = await this.inner.clockIn(siteCode, requestId);
    if (this.plan.shift() === true) {
      throw new ServerTransportError();
    }
    return result;
  }
}

describe('D5 Staff App attendant mode client', () => {
  it('clocks in by scanning the site code in one tap: the site comes back from the server', async () => {
    const client = buildClient();

    const clockedIn = await client.clockIn(RIGHT_CODE);

    expect(clockedIn).toEqual({ ok: true, value: { siteId: SITE_ID, clockedIn: true } });
    expect(client.sessionSiteId()).toBe(SITE_ID);
    expect(client.pendingClockInRequestId()).toBeUndefined();
  });

  it('shows the server refusal for a forged code and binds no site', async () => {
    const client = buildClient();

    const first = await client.clockIn('not-a-site-code');
    const second = await client.clockIn('not-a-site-code');

    expect(first).toEqual({ ok: false, error: 'forged code' });
    expect(second).toEqual(first);
    expect(client.sessionSiteId()).toBeUndefined();
  });

  it('shows the server refusal as it is, whatever its name', async () => {
    const refusing: AttendantModeApi = {
      clockIn: async () => {
        throw new AttendantModeRefusedError('licence not live');
      },
    };

    expect(await buildClient(refusing).clockIn('attendant-site-1')).toEqual({ ok: false, error: 'licence not live' });
  });

  it('keeps the same request id for the retry after a lost answer, and binds the site only once the answer arrives', async () => {
    const api = new AnswerLosingApi(new InMemoryAttendantModeApi(), [true, false]);
    const client = buildClient(api);

    const lost = await client.clockIn(RIGHT_CODE);
    expect(lost).toEqual({ ok: false, error: 'connection lost', requestId: 'd5-req-0001' });
    expect(client.sessionSiteId()).toBeUndefined();
    expect(client.pendingClockInRequestId()).toBe('d5-req-0001');

    const retry = await client.clockIn(RIGHT_CODE);

    expect(retry).toEqual({ ok: true, value: { siteId: SITE_ID, clockedIn: true } });
    expect(api.seenRequestIds).toEqual(['d5-req-0001', 'd5-req-0001']);
    expect(client.pendingClockInRequestId()).toBeUndefined();
  });
});
