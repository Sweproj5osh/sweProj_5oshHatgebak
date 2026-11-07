import { describe, expect, it } from 'vitest';
import { composeInMemoryServer, type InMemoryApplication } from '../../../entrypoint/composition';
import { TEST_TOKEN_SECRET, tokenFor } from '../../../entrypoint/test-helpers';
import type { PersonId, SiteId } from '../../../shared/identifiers';
import { answerDroppingHandle, type AnswerDrops } from '../../test-support/answer-dropping-handle';
import { AttendantModeClient } from './attendant-mode-client';
import { HttpAttendantModeApi } from './http-attendant-mode-api';

/**
 * D5 over the composed in-memory server: the real clock-in (Lino's licensing module) answers the route the Staff App
 * calls. The Chair creates a district, a zone and a site, and an attendant assigned and licensed there; the attendant
 * scans the site's genuine entry code.
 */
const OUTLINE = [
  { latitude: 30.0624, longitude: 31.2195 },
  { latitude: 30.0624, longitude: 31.2199 },
  { latitude: 30.0628, longitude: 31.2199 },
  { latitude: 30.0628, longitude: 31.2195 },
];

function valueOf<Value>(outcome: { ok: true; value: Value } | { ok: false; error: string }): Value {
  if (!outcome.ok) {
    throw new Error(`set-up refused: ${outcome.error}`);
  }
  return outcome.value;
}

async function licensedAttendantAtOneSite(app: InMemoryApplication): Promise<{ attendant: PersonId; siteId: SiteId; siteCode: string }> {
  const { accounts, siteRegistry, licensing } = app.moduleDependencies;
  const chair = valueOf(await accounts.bootstrapChair('01000000000', 'The Chair'));
  const districtId = valueOf(await siteRegistry.createDistrict(chair, 'Zamalek'));
  const zoneId = valueOf(await siteRegistry.createZone(chair, districtId, 'Zamalek zone 1'));
  const siteId = valueOf(await siteRegistry.createSite(chair, zoneId, '26 July Street', OUTLINE, 12));
  const attendant = valueOf(await accounts.personalData.createPerson(chair, 'attendant', '01022222222', 'An Attendant'));
  valueOf(await licensing.assignments.assignAttendantToSite(chair, attendant, siteId, 'morning'));
  valueOf(await licensing.licences.issueLicence(chair, attendant));
  const { entryCode } = await siteRegistry.issueEntryAndExitCodes(siteId);
  return { attendant, siteId, siteCode: entryCode };
}

async function buildStack(drops: AnswerDrops = { remaining: 0 }) {
  const app = composeInMemoryServer({ tokenSecret: TEST_TOKEN_SECRET });
  const { attendant, siteId, siteCode } = await licensedAttendantAtOneSite(app);
  const api = new HttpAttendantModeApi({ handle: answerDroppingHandle(app.handle, drops), token: () => tokenFor('attendant', { personId: attendant }) });
  let serial = 1;
  const client = new AttendantModeClient({ api, createRequestId: () => `d5-http-req-${String(serial++).padStart(4, '0')}` });
  const isClockedIn = () => app.moduleDependencies.licensing.attendance.isClockedIn(attendant);
  return { client, audit: app.audit, attendant, siteId, siteCode, isClockedIn };
}

describe('D5 clock-in over the HTTP entry point', () => {
  it('sends the scanned code only; the server binds the site and names the attendant from the token', async () => {
    const { client, audit, attendant, siteId, siteCode } = await buildStack();

    const clockedIn = await client.clockIn(siteCode);

    expect(clockedIn).toEqual({ ok: true, value: { siteId, clockedIn: true } });
    expect(client.sessionSiteId()).toBe(siteId);
    const [entry] = await audit.readByScope({ personId: attendant, role: 'attendant' });
    expect(entry).toMatchObject({ operation: 'attendance.clockIn', personId: attendant, input: { siteCode } });
  });

  it('is accepted by a server that declares Lino\'s schema { siteCode }: the attendant is clocked in at the site', async () => {
    const { client, siteCode, isClockedIn } = await buildStack();

    await client.clockIn(siteCode);

    expect(await isClockedIn()).toBe(true);
  });

  it('shows a forged code as the server refusal, binds no site and leaves no audit entry', async () => {
    const { client, audit, attendant } = await buildStack();

    expect(await client.clockIn('not-a-signed-code')).toEqual({ ok: false, error: 'forged code' });
    expect(client.sessionSiteId()).toBeUndefined();
    expect(await audit.readByScope({ personId: attendant, role: 'attendant' })).toHaveLength(0);
  });

  it('airplane mode after the clock-in was applied, then retry with the kept id: one session, one audit entry', async () => {
    const { client, audit, attendant, siteId, siteCode } = await buildStack({ remaining: 1 });

    const lost = await client.clockIn(siteCode);
    expect(lost).toEqual({ ok: false, error: 'connection lost', requestId: 'd5-http-req-0001' });
    expect(client.sessionSiteId()).toBeUndefined();

    const retry = await client.clockIn(siteCode);

    expect(retry).toEqual({ ok: true, value: { siteId, clockedIn: true } });
    expect(await audit.readByScope({ personId: attendant, role: 'attendant' })).toHaveLength(1);
  });
});
