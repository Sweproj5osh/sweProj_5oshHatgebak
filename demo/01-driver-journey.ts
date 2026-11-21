/**
 * Demo 1: the journey of a driver, on the real server wiring (the same composition `npm start` uses).
 *
 *   committee sets up a street  ->  driver signs in and registers a car  ->  driver scans the entry code
 *   -> the server refuses what it must refuse  ->  the audit trail shows every action and no personal data.
 *
 * Run from the repository root:   npx tsx demo/01-driver-journey.ts
 */
import { composeInMemoryServer } from '../src/entrypoint/composition';
import { BOOTSTRAP_CHAIR_NAME_VARIABLE, BOOTSTRAP_CHAIR_PHONE_VARIABLE } from '../src/entrypoint/bootstrap';
import type { HttpRequest } from '../src/entrypoint/http';
import { signedSiteCodes } from '../src/modules/sites-and-areas/public';
import { REQUEST_ID_HEADER } from '../src/shared/request-id';
import { bodyOf, bold, dim, expectThat, note, say, scene, showExchange, table, title } from './lib';

const TOKEN_SECRET = 'demo-token-secret-that-is-long-enough';
const SITE_CODE_SECRET = 'demo-site-code-secret-long-enough';
const CHAIR_PHONE = '01099990001';
const CHAIR_PASSWORD = 'correct horse battery staple';
const CLIENT_ADDRESS = '203.0.113.7';

/** The recording sender keys codes by the international form of the number: 01012345678 becomes +201012345678. */
const international = (phone: string): string => `+20${phone.slice(1)}`;

const app = composeInMemoryServer({ tokenSecret: TOKEN_SECRET, siteCodeSecret: SITE_CODE_SECRET });

let requestCounter = 0;
/** Request ids of writes the server refused: the audit trail must hold no entry for any of them. */
const refusedWriteRequestIds: string[] = [];
const nextRequestId = (): string => `demo-request-${String((requestCounter += 1)).padStart(4, '0')}`;

interface Call {
  readonly token?: string;
  readonly requestId?: string;
  readonly body?: unknown;
  readonly query?: Record<string, string>;
}

/** Sends one request through the real entry point, the way the HTTP server would hand it over. */
async function send(label: string, method: 'GET' | 'POST', path: string, call: Call = {}, quiet = false) {
  const headers: Record<string, string> = {};
  if (call.token !== undefined) {
    headers['authorization'] = `Bearer ${call.token}`;
  }
  if (method === 'POST' || call.requestId !== undefined) {
    headers[REQUEST_ID_HEADER] = call.requestId ?? nextRequestId();
  }
  const request: HttpRequest = {
    method,
    path,
    query: call.query ?? {},
    headers,
    address: CLIENT_ADDRESS,
    ...(call.body === undefined ? {} : { body: call.body }),
  };
  const response = await app.handle(request);
  if (method === 'POST' && response.status >= 400) {
    refusedWriteRequestIds.push(headers[REQUEST_ID_HEADER] ?? '');
  }
  if (!quiet) {
    showExchange(label, { ...request, headers: {} }, response);
  }
  return response;
}

/** Phone number + one-time code, as the Driver App does it. The code lands in the recording sender (no SMS provider yet). */
/** A set-up step that must work for the rest of the demo to make sense: stop at once, with the server's own words. */
function mustBe(response: { status: number; body: unknown }, status: number, what: string): void {
  if (response.status !== status) {
    throw new Error(`${what}: expected ${status} but the server answered ${response.status} ${JSON.stringify(response.body)}`);
  }
}

async function signInDriver(phone: string, quiet = true): Promise<string> {
  await send('Ask for a one-time code', 'POST', '/sign-in/code', { body: { phone } }, quiet);
  const code = app.signInCodes.lastCodeSentTo(international(phone)) ?? 'no code was sent';
  const signedIn = await send('Sign in with the code', 'POST', '/sign-in', { body: { phone, code } }, quiet);
  return bodyOf<{ token: string }>(signedIn).token;
}

async function addCar(token: string, plate: string): Promise<string> {
  const added = await send('Register a car', 'POST', '/cars', { token, body: { plate } }, true);
  return bodyOf<{ carRef: string }>(added).carRef;
}

async function main(): Promise<void> {
  title('DEMO 1  -  A driver parks on a Cairo street (real server wiring, in-memory storage)');
  say('Every step below is a real request through the same entry point the server uses.');
  say('Only the phone network and the SMS provider are replaced by in-memory stand-ins.');

  // ---------------------------------------------------------------------------------------------------------------
  scene(1, 'The system starts and creates its first Chair (committee head)');
  note('The Chair is created once from the environment as an audited action of the system itself.');
  const bootstrap = await app.bootstrapFirstChair({
    [BOOTSTRAP_CHAIR_PHONE_VARIABLE]: CHAIR_PHONE,
    [BOOTSTRAP_CHAIR_NAME_VARIABLE]: 'Chair of the Governorate Committee',
  });
  if (bootstrap.kind !== 'bootstrapped') {
    throw new Error(`the first Chair was not created: ${JSON.stringify(bootstrap)}`);
  }
  say(`First Chair created: ${bold(bootstrap.chairId)}`);
  const second = await app.bootstrapFirstChair({
    [BOOTSTRAP_CHAIR_PHONE_VARIABLE]: CHAIR_PHONE,
    [BOOTSTRAP_CHAIR_NAME_VARIABLE]: 'Someone else',
  });
  expectThat(second.kind === 'already bootstrapped', 'Running the bootstrap again does nothing (it can happen only once)');

  // ---------------------------------------------------------------------------------------------------------------
  scene(2, 'The Chair signs in with two steps: a one-time code, then a password');
  note('Committee roles need a password as a second factor. Setting the very first password is an operator action.');
  await app.accounts.signIn.setCommitteePassword(bootstrap.chairId, bootstrap.chairId, CHAIR_PASSWORD);
  await send('Ask for a one-time code', 'POST', '/sign-in/code', { body: { phone: CHAIR_PHONE } });
  const chairCode = app.signInCodes.lastCodeSentTo(international(CHAIR_PHONE)) ?? 'no code was sent';
  const codeOnly = await send('Code alone is not enough for the Chair', 'POST', '/sign-in', { body: { phone: CHAIR_PHONE, code: chairCode } });
  expectThat(codeOnly.status === 401, 'A committee role cannot sign in with the code alone ("second step required")');
  await send('Ask for a fresh code', 'POST', '/sign-in/code', { body: { phone: CHAIR_PHONE } }, true);
  const freshCode = app.signInCodes.lastCodeSentTo(international(CHAIR_PHONE)) ?? 'no code was sent';
  const chairSignIn = await send('Code + password', 'POST', '/sign-in/committee', {
    body: { phone: CHAIR_PHONE, code: freshCode, password: CHAIR_PASSWORD },
  });
  expectThat(chairSignIn.status === 200, 'The Chair is signed in');
  mustBe(chairSignIn, 200, 'Chair sign-in');
  const chairToken = bodyOf<{ token: string }>(chairSignIn).token;

  // ---------------------------------------------------------------------------------------------------------------
  scene(3, 'The committee creates a district, a zone and a street (a "site") with its spaces and hours');
  const district = await send('Create district', 'POST', '/districts', { token: chairToken, body: { label: 'Zamalek' } });
  mustBe(district, 201, 'Create district');
  const districtId = bodyOf<{ districtId: string }>(district).districtId;
  const zone = await send('Create zone', 'POST', '/zones', { token: chairToken, body: { districtId, label: 'Zamalek zone 1' } });
  mustBe(zone, 201, 'Create zone');
  const zoneId = bodyOf<{ zoneId: string }>(zone).zoneId;
  const outline = [
    { latitude: 30.0624, longitude: 31.2195 },
    { latitude: 30.0624, longitude: 31.2199 },
    { latitude: 30.0628, longitude: 31.2199 },
    { latitude: 30.0628, longitude: 31.2195 },
  ];
  const site = await send('Create site with 3 spaces', 'POST', '/sites', {
    token: chairToken,
    body: { zoneId, label: '26 July Street', outline, capacity: 3 },
  });
  mustBe(site, 201, 'Create site');
  const siteId = bodyOf<{ siteId: string }>(site).siteId;
  await send('Open every day, all day', 'POST', '/sites/hours', { token: chairToken, body: { siteId, hours: 'daily 00:00-24:00' } });
  await send('Read the site back', 'GET', '/sites/status', { token: chairToken, query: { siteId } });
  const codes = signedSiteCodes(SITE_CODE_SECRET, siteId);
  note('The committee prints two signed codes for the street signs: one at the entrance, one at the exit.');
  say(`Entry code (printed on the sign): ${dim(codes.entryCode.slice(0, 44))}...`);
  say(`Exit code  (printed on the sign): ${dim(codes.exitCode.slice(0, 44))}...`);

  // ---------------------------------------------------------------------------------------------------------------
  scene(4, 'A driver opens the app, signs in with a phone number, and saves a car');
  const driverPhone = '01011112222';
  await send('Ask for a one-time code', 'POST', '/sign-in/code', { body: { phone: driverPhone } });
  const driverCode = app.signInCodes.lastCodeSentTo(international(driverPhone)) ?? 'no code was sent';
  const driverSignIn = await send('Sign in with the code (first time = account is created)', 'POST', '/sign-in', {
    body: { phone: driverPhone, code: driverCode },
  });
  expectThat(driverSignIn.status === 201, 'A new phone number becomes a driver account');
  mustBe(driverSignIn, 201, 'Driver sign-in');
  const driverToken = bodyOf<{ token: string }>(driverSignIn).token;
  const car = await send('Save a car by plate', 'POST', '/cars', { token: driverToken, body: { plate: 'ABC 123' } });
  mustBe(car, 201, 'Save a car');
  const carRef = bodyOf<{ carRef: string }>(car).carRef;
  say(`The rest of the system only ever sees the car reference ${bold(carRef)}, never the plate.`);

  // ---------------------------------------------------------------------------------------------------------------
  scene(5, 'The driver looks at the map and checks free spaces before driving there');
  note('Expect two server log lines below: the map\'s free-space band and first-hour fee are not wired into the');
  note('composition yet (known gap, QUESTIONS.md item 17), so the map answers "unknown" for them and keeps working.');
  await send('Streets near the driver', 'GET', '/sites/nearby', {
    token: driverToken,
    query: { latitude: '30.0626', longitude: '31.2197', radius: '1500' },
  });
  const spaces = await send('Free spaces on 26 July Street', 'GET', '/tickets/free-spaces', { token: driverToken, query: { siteId } });
  expectThat(bodyOf<{ freeSpaces: number }>(spaces).freeSpaces === 3, 'All 3 spaces are free');

  // ---------------------------------------------------------------------------------------------------------------
  scene(6, 'The driver scans the entry code: a ticket opens, time is stamped by the SERVER');
  const entryRequestId = nextRequestId();
  const opened = await send('Scan entry code', 'POST', '/tickets/open', {
    token: driverToken,
    requestId: entryRequestId,
    body: { siteId, carRef, entryCode: codes.entryCode },
  });
  expectThat(opened.status === 201, 'Ticket opened');
  const ticket = bodyOf<{ ticket: { ticketId: string; state: string; openedAt: string } }>(opened).ticket;
  say(`Ticket ${bold(ticket.ticketId)} is ${ticket.state}, opened at ${ticket.openedAt} (server clock).`);

  // ---------------------------------------------------------------------------------------------------------------
  scene(7, 'The server refuses what it must refuse');
  const repeated = await send('Weak signal: the phone resends the SAME scan with the SAME request id', 'POST', '/tickets/open', {
    token: driverToken,
    requestId: entryRequestId,
    body: { siteId, carRef, entryCode: codes.entryCode },
  });
  expectThat(repeated.status === 201 && JSON.stringify(repeated.body) === JSON.stringify(opened.body), 'Same request id = same answer, no second ticket');

  const sameCarAgain = await send('A new scan for a car that is already parked', 'POST', '/tickets/open', {
    token: driverToken,
    body: { siteId, carRef, entryCode: codes.entryCode },
  });
  expectThat(sameCarAgain.status === 409, 'One open ticket per car');

  const forged = await send('A made-up code (someone prints a fake sign)', 'POST', '/tickets/open', {
    token: driverToken,
    body: { siteId, carRef, entryCode: 'entry-this-is-not-a-real-code' },
  });
  expectThat(forged.status === 403, 'Forged codes are rejected (codes are signed)');

  const cheeky = await send('A phone that tries to choose its own entry time', 'POST', '/tickets/open', {
    token: driverToken,
    body: { siteId, carRef, entryCode: codes.entryCode, openedAt: '2020-01-01T00:00:00Z' },
  });
  expectThat(cheeky.status === 400, 'No client may send a time: the server clock is the only clock');

  const otherDriverToken = await signInDriver('01033334444');
  const strangersCar = await send("Another driver scans using the first driver's car", 'POST', '/tickets/open', {
    token: otherDriverToken,
    body: { siteId, carRef, entryCode: codes.entryCode },
  });
  expectThat(strangersCar.status === 403, 'A driver can only park a car registered to them');

  const driverCreatesDistrict = await send('A driver tries to create a district', 'POST', '/districts', {
    token: driverToken,
    body: { label: 'Hacked district' },
  });
  expectThat(driverCreatesDistrict.status === 403, 'Roles are enforced: drivers cannot act as the committee');

  const noToken = await send('A request without any token', 'GET', '/tickets');
  expectThat(noToken.status === 401, 'No token, no answer (the route table is not even discoverable)');

  // ---------------------------------------------------------------------------------------------------------------
  scene(8, 'The street fills up: exactly as many tickets as spaces');
  const driverB = await signInDriver('01055556666');
  const carB = await addCar(driverB, 'XYZ 789');
  const driverC = await signInDriver('01077778888');
  const carC = await addCar(driverC, 'KLM 456');
  const driverD = await signInDriver('01088889999');
  const carD = await addCar(driverD, 'QRS 321');
  await send('Driver B scans the entry code', 'POST', '/tickets/open', { token: driverB, body: { siteId, carRef: carB, entryCode: codes.entryCode } });
  await send('Driver C scans the entry code', 'POST', '/tickets/open', { token: driverC, body: { siteId, carRef: carC, entryCode: codes.entryCode } });
  const full = await send('Driver D arrives, but the street is full', 'POST', '/tickets/open', {
    token: driverD,
    body: { siteId, carRef: carD, entryCode: codes.entryCode },
  });
  expectThat(full.status === 409 && bodyOf<{ error: string }>(full).error === 'site full', 'The 4th car is refused: "site full"');
  const noSpaces = await send('Free spaces now', 'GET', '/tickets/free-spaces', { token: driverD, query: { siteId } });
  expectThat(bodyOf<{ freeSpaces: number }>(noSpaces).freeSpaces === 0, 'The free-space count is derived from the tickets: 0 left');
  const history = await send("Driver A's ticket history", 'GET', '/tickets', { token: driverToken });
  expectThat(bodyOf<{ tickets: unknown[] }>(history).tickets.length === 1, 'Each driver sees only their own tickets');

  // ---------------------------------------------------------------------------------------------------------------
  scene(9, 'Accountability: the Chair reads the audit trail');
  const trail = await send('Read the audit log', 'GET', '/audit-log', { token: chairToken }, true);
  const entries = bodyOf<{ entries: AuditRow[] }>(trail).entries;
  table([
    ['#', 'who', 'operation', 'request id', 'hash (start)'],
    ...entries.map((entry) => [
      String(entry.id),
      entry.actorKind === 'person' ? `${entry.role}` : entry.actorKind,
      entry.operation,
      entry.requestId.slice(0, 18),
      entry.hash.slice(0, 10),
    ]),
  ]);
  const verification = await send('Is the chain unbroken?', 'GET', '/audit-log/verification', { token: chairToken });
  expectThat(bodyOf<{ chainIntact: boolean }>(verification).chainIntact, 'Every entry is chained to the one before it (hash chain intact)');
  const everything = JSON.stringify(entries);
  const leaks = ['ABC 123', 'XYZ 789', driverPhone, CHAIR_PHONE, CHAIR_PASSWORD, freshCode, driverCode].filter((secret) => everything.includes(secret));
  expectThat(leaks.length === 0, 'The audit trail holds no plate, no phone number, no password and no sign-in code');
  const entryForRefused = entries.filter((entry) => refusedWriteRequestIds.includes(entry.requestId));
  expectThat(
    refusedWriteRequestIds.length > 0 && entryForRefused.length === 0,
    `${refusedWriteRequestIds.length} refused writes above left no audit entry (only successful writes are recorded)`,
  );
  const opens = entries.filter((entry) => entry.operation === 'ticketing.openTicket').length;
  expectThat(opens === 3, `3 tickets opened = exactly 3 audit entries for opening (the repeats and refusals left none)`);

  console.log('');
  say(bold('Demo 1 complete.'));
}

interface AuditRow {
  readonly id: number;
  readonly actorKind: string;
  readonly role?: string;
  readonly operation: string;
  readonly requestId: string;
  readonly hash: string;
}

await main();
