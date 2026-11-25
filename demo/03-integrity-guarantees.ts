/**
 * Demo 3: the guarantees the project ranks first (integrity, then accountability), shown under stress.
 *
 *   20 drivers want 5 spaces  ->  a phone retries the same scan 10 times at once  ->  a stolen request id
 *   is reused with other content  ->  somebody guesses sign-in codes  ->  fees can never pass the cap
 *   ->  somebody edits a copy of the audit log and is caught; the real log cannot be edited at all.
 *
 * Uses the project's test composition (stand-in site register: every street has 5 spaces and signs "entry-<site>"),
 * the same one the project's own fitness functions run on.
 *
 * Run from the repository root:   npx tsx demo/03-integrity-guarantees.ts
 */
import { PostgresAuditLogStore } from '../src/server/adapters/postgres/postgres-audit-log-store';
import { createHashChainedAuditTrail, type AuditLogStore } from '../src/server/modules/foundation/audit-log/index';
import { ArrayAuditLogStore } from '../src/server/test-support/array-audit-log-store';
import { composeTestApplication } from '../src/server/test-support/compose-test-application';
import type { HttpRequest } from '../src/server/http/http';
import { TEST_ADDRESS, TEST_TOKEN_SECRET, tokenFor } from '../src/server/test-support/test-helpers';
import { createFeeCalculator, type PriceVersion } from '../src/server/modules/parking-and-prices/committee-prices/index';
import { createTicketOpening, TableTicketStore } from '../src/server/modules/parking-and-prices/ticketing/index';
import { FixedClock } from '../src/server/shared/clock';
import { REQUEST_ID_HEADER } from '../src/server/shared/request-id';
import { fail, succeed } from '../src/server/shared/result';
import { bodyOf, bold, demoDatabase, expectThat, note, say, scene, showExchange, title } from './lib';

const clock = new FixedClock(new Date('2026-11-09T08:00:00Z'));
const app = composeTestApplication({ database: await demoDatabase('integrity'), tokenSecret: TEST_TOKEN_SECRET, clock });

function driverRequest(personId: string, requestId: string, body: unknown, path = '/tickets'): HttpRequest {
  return {
    method: 'POST',
    path,
    query: {},
    headers: { authorization: `Bearer ${tokenFor('driver', { personId })}`, [REQUEST_ID_HEADER]: requestId },
    address: TEST_ADDRESS,
    body,
  };
}

const parkingBody = (carRef: string, siteId: string) => ({ siteId, carRef, entryCode: `entry-${siteId}` });

async function main(): Promise<void> {
  title('DEMO 3  -  Integrity under stress');
  say('Rank 1 of the project is integrity: exactly as many tickets as spaces, fees never above the cap,');
  say('and a history nobody can quietly rewrite. Here is each promise being attacked.');

  // ---------------------------------------------------------------------------------------------------------------
  scene(1, 'Twenty drivers want the 5 spaces of one street: exactly 5 tickets are ever issued');
  note('(a) Twenty drivers arrive one after another, each through the real entry point.');
  const arrivals: number[] = [];
  for (let index = 1; index <= 20; index += 1) {
    const number = String(index).padStart(2, '0');
    const answer = await app.handle(driverRequest(`driver-${number}`, `arrival-request-${number}`, parkingBody(`car-${number}`, 'site-1')));
    arrivals.push(answer.status);
  }
  const winners = arrivals.filter((status) => status === 201).length;
  say(`Answers: ${bold(String(winners))} x 201 "ticket opened",  ${bold(String(arrivals.length - winners))} x 409 "site full"`);
  expectThat(winners === 5 && arrivals.length - winners === 15, 'Exactly 5 tickets for 5 spaces, the other 15 are refused');
  const openNow = await app.moduleDependencies.tickets.countOpen(app.database, 'site-1');
  expectThat(openNow === 5, `The tickets themselves agree: ${openNow} open tickets at the street (free spaces are counted from tickets, never stored)`);

  note('(b) Twenty openers race at the same instant inside one unit of work: the project\'s own fitness function F3.');
  const raceDatabase = await demoDatabase('integrity_race');
  const raceStore = new TableTicketStore();
  const opening = createTicketOpening({
    sites: {
      verifyEntryCode: async (code, siteId) => (code === `entry-${siteId}` ? succeed(siteId) : fail('forged')),
      verifyExitCode: async (code, siteId) => (code === `exit-${siteId}` ? succeed(siteId) : fail('forged')),
      isOpenAt: async () => true,
      capacityOf: async () => 5,
    },
    carOwnership: { carBelongsTo: async () => true },
    store: raceStore,
    clock,
  });
  const transaction = raceDatabase.begin();
  const raced = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      opening.openTicket(transaction, {
        requestId: `f3-request-${index}`,
        driverRef: `driver-f3-${index}`,
        carRef: `car-f3-${index}`,
        siteId: 'site-1',
        entryCode: 'entry-site-1',
      }),
    ),
  );
  await transaction.commit();
  const raceWinners = raced.filter((result) => result.ok).length;
  expectThat(raceWinners === 5, `20 simultaneous opens, 5 spaces: ${raceWinners} tickets (the check and the insert are one indivisible step)`);
  note('For two separate simultaneous requests see demo/known-gap-parallel-requests.ts (it needs the PostgreSQL site lock).');

  // ---------------------------------------------------------------------------------------------------------------
  scene(2, 'Weak signal: the phone sends the SAME scan 10 times at once (same request id)');
  const storm = await Promise.all(
    Array.from({ length: 10 }, () => app.handle(driverRequest('driver-weak-signal', 'storm-request-0001', parkingBody('car-weak', 'site-2')))),
  );
  const distinctAnswers = new Set(storm.map((response) => JSON.stringify(response.body)));
  expectThat(storm.every((response) => response.status === 201) && distinctAnswers.size === 1, '10 requests, one identical answer for all of them');
  const openAtSite2 = await app.moduleDependencies.tickets.countOpen(app.database, 'site-2');
  expectThat(openAtSite2 === 1, `...and only ${openAtSite2} ticket was created (the database changed once)`);

  // ---------------------------------------------------------------------------------------------------------------
  scene(3, 'A request id is reused with different content');
  const reused = driverRequest('driver-weak-signal', 'storm-request-0001', parkingBody('car-other', 'site-2'));
  const reusedAnswer = await app.handle(reused);
  showExchange('Same request id, different car', reused, reusedAnswer);
  expectThat(reusedAnswer.status === 409, 'Refused: one request id means one exact request, and nothing was written');

  // ---------------------------------------------------------------------------------------------------------------
  scene(4, 'Somebody guesses sign-in codes for a phone number');
  const attempts: number[] = [];
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    const guess = await app.handle({
      method: 'POST',
      path: '/sessions',
      query: {},
      headers: { [REQUEST_ID_HEADER]: `guess-request-${String(attempt).padStart(4, '0')}` },
      address: TEST_ADDRESS,
      body: { phone: '01012340000', code: String(100000 + attempt) },
    });
    attempts.push(guess.status);
  }
  say(`Answers to 7 wrong guesses in a row: ${attempts.join(', ')}`);
  note('401 = wrong code; 429 = too many attempts (5 per phone per 10 minutes); 423 = locked.');
  expectThat(attempts.slice(5).every((status) => status === 429 || status === 423), 'After a few wrong codes the door shuts, so codes cannot be brute-forced');

  // ---------------------------------------------------------------------------------------------------------------
  scene(5, 'Fees can never pass the committee cap, whatever the stay (2,000 random stays checked)');
  const version: PriceVersion = { versionId: 'price-x', siteId: 'site-1', firstHourFee: 10, eachLaterHourFee: 5, dailyCap: 50, validFrom: '2026-11-01T00:00:00.000Z' };
  const fees = createFeeCalculator();
  const entry = new Date('2026-11-09T08:00:00Z');
  let highest = 0;
  let overCap = 0;
  let seed = 20260921;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let index = 0; index < 2000; index += 1) {
    const minutes = Math.floor(random() * 60 * 24 * 30);
    const fee = fees.computeFee(entry, new Date(entry.getTime() + minutes * 60_000), version);
    highest = Math.max(highest, fee);
    if (fee > version.dailyCap) {
      overCap += 1;
    }
  }
  say(`Stays from 0 minutes to 30 days. Highest fee seen: ${bold(`${highest} EGP`)} (cap is ${version.dailyCap} EGP).`);
  expectThat(overCap === 0, 'Not one of 2,000 stays was charged above the cap');

  // ---------------------------------------------------------------------------------------------------------------
  scene(6, 'Somebody edits the audit log directly in the database to hide an action');
  const chairRead = (path: string): HttpRequest => ({
    method: 'GET',
    path,
    query: {},
    headers: { authorization: `Bearer ${tokenFor('chair')}` },
    address: TEST_ADDRESS,
  });
  const verify = async (): Promise<boolean> => bodyOf<{ chainIntact: boolean }>(await app.handle(chairRead('/audit-log/verification'))).chainIntact;
  const entries = await app.audit.readByScope({ personId: 'chair-1', role: 'chair' });
  say(`The log holds ${entries.length} entries, one per successful write.`);
  expectThat(await verify(), 'Before the attack: the chain verifies');

  try {
    await app.database.replace('audit_log', '3', {});
    expectThat(false, 'The application\'s own table access refuses to touch audit_log');
  } catch (error) {
    expectThat(true, `The application's own table access refuses to touch audit_log ("${error instanceof Error ? error.message : String(error)}")`);
  }

  note('The real log cannot be edited: the application\'s database role has no UPDATE or DELETE right on audit_log');
  note('(npm test proves it, task Z2). So the attacker edits a copy of the stored records, and verification is run on that copy.');
  const stored = new PostgresAuditLogStore(app.database.committed);
  const records = await stored.readAll();
  const head = await stored.head();
  const verifyCopy = (copy: AuditLogStore) => createHashChainedAuditTrail(copy, clock).verifyChain();
  const target = records.find((record) => record.id === 3);
  if (target === undefined) {
    throw new Error('entry 3 was expected to exist');
  }
  say(`Entry 3 says the operation was ${bold(target.operation)} by ${String(target.personId)}.`);
  const edited = new ArrayAuditLogStore(records.map((record) => (record.id === 3 ? { ...record, personId: 'driver-innocent' } : record)), head);
  say('The attacker changes the name of the person who did it...');
  expectThat(!(await verifyCopy(edited)), 'Verification FAILS: the edited entry no longer matches its hash');
  expectThat(await verifyCopy(new ArrayAuditLogStore(records, head)), '(An untouched copy verifies, so the check itself is not stuck on "broken")');

  const last = entries[entries.length - 1]!;
  say(`Second attack: delete the most recent entry (#${last.id}) so the log looks shorter...`);
  const shortened = new ArrayAuditLogStore(records.filter((record) => record.id !== last.id), head);
  expectThat(!(await verifyCopy(shortened)), 'Verification FAILS: the head record still names the deleted entry, so a cut tail is caught');
  expectThat(await verify(), '(The real log was never touched: it still verifies)');
  note('Head table used for the tail check: audit_log.head.');

  console.log('');
  say(bold('Demo 3 complete.'));
}

await main();
