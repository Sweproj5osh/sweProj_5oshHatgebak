import { describe, expect, it } from 'vitest';
import { TEST_TOKEN_SECRET, testApplication, tokenFor } from '../../../entrypoint/test-helpers';
import { answerDroppingHandle, type AnswerDrops } from '../../test-support/answer-dropping-handle';
import { createStandInAttendanceOperations, createStandInAttendanceState } from '../../test-support/stand-in-attendance-operations';
import { AttendantModeClient } from './attendant-mode-client';
import { HttpAttendantModeApi } from './http-attendant-mode-api';

/** The token the test helpers mint for an attendant names this person; the stand-in assigns them to site-1. */
const ATTENDANT_OF_THE_TOKEN = 'attendant-1';
const SITE_CODE = 'SAYES1.entry.c2l0ZS0x.signature';

function buildStack(drops: AnswerDrops = { remaining: 0 }) {
  const attendance = createStandInAttendanceState({ [SITE_CODE]: 'site-1' }, { [ATTENDANT_OF_THE_TOKEN]: 'site-1' });
  const app = testApplication({ tokenSecret: TEST_TOKEN_SECRET, additionalOperations: createStandInAttendanceOperations(attendance) });
  const api = new HttpAttendantModeApi({ handle: answerDroppingHandle(app.handle, drops), token: () => tokenFor('attendant') });
  let serial = 1;
  const client = new AttendantModeClient({ api, createRequestId: () => `d5-http-req-${String(serial++).padStart(4, '0')}` });
  return { client, attendance, audit: app.audit };
}

describe('D5 clock-in over the HTTP entry point', () => {
  it('sends the scanned code only; the server binds the site and names the attendant from the token', async () => {
    const { client, audit } = buildStack();

    const clockedIn = await client.clockIn(SITE_CODE);

    expect(clockedIn).toEqual({ ok: true, value: { siteId: 'site-1', clockedIn: true } });
    expect(client.sessionSiteId()).toBe('site-1');
    const [entry] = await audit.readByScope({ personId: ATTENDANT_OF_THE_TOKEN, role: 'attendant' });
    expect(entry).toMatchObject({ operation: 'attendance.clockIn', personId: ATTENDANT_OF_THE_TOKEN, input: { siteCode: SITE_CODE } });
  });

  it('is accepted by a server that declares Lino\'s schema { siteCode }: an attendantId in the body would be refused with 400', async () => {
    const { client, attendance } = buildStack();

    await client.clockIn(SITE_CODE);

    expect(attendance.clockedInAt.get(ATTENDANT_OF_THE_TOKEN)).toBe('site-1');
  });

  it('shows a forged code as the server refusal, binds no site and leaves no audit entry', async () => {
    const { client, audit } = buildStack();

    expect(await client.clockIn('not-a-signed-code')).toEqual({ ok: false, error: 'forged code' });
    expect(client.sessionSiteId()).toBeUndefined();
    expect(await audit.readByScope({ personId: ATTENDANT_OF_THE_TOKEN, role: 'attendant' })).toHaveLength(0);
  });

  it('airplane mode after the clock-in was applied, then retry with the kept id: one session, one audit entry', async () => {
    const { client, audit } = buildStack({ remaining: 1 });

    const lost = await client.clockIn(SITE_CODE);
    expect(lost).toEqual({ ok: false, error: 'connection lost', requestId: 'd5-http-req-0001' });
    expect(client.sessionSiteId()).toBeUndefined();

    const retry = await client.clockIn(SITE_CODE);

    expect(retry).toEqual({ ok: true, value: { siteId: 'site-1', clockedIn: true } });
    expect(await audit.readByScope({ personId: ATTENDANT_OF_THE_TOKEN, role: 'attendant' })).toHaveLength(1);
  });
});
