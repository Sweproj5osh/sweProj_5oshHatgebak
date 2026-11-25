/**
 * Demo 2: leaving the street. The exit scan freezes the time, the server computes the fee from the committee's price,
 * the driver pays in the app, and gets a receipt.
 *
 * Why this demo uses the project's test composition: on the real server wiring the committee's price approval
 * (the Approvals module) is not composed yet, so no price can be applied there and a ticket cannot close with a fee.
 * The tests solve this with `composeInMemoryApplication`, and so does this demo: same entry point, same Ticketing,
 * Committee Prices and Payments modules; only the site register and the approval check are stand-ins, and the time
 * is a clock the script moves forward.
 *
 * Run from the repository root:   npx tsx demo/02-fees-and-payment.ts
 */
import { composeInMemoryApplication } from '../src/server/test-support/compose-test-application';
import type { HttpRequest } from '../src/server/http/http';
import { TEST_ADDRESS, TEST_TOKEN_SECRET, tokenFor } from '../src/server/test-support/test-helpers';
import { createFeeCalculator, createPriceList, type PriceVersion } from '../src/server/modules/parking-and-prices/committee-prices/index';
import { createFakePaymentGateway, createPayments } from '../src/modules/payments/public';
import { createTicketPaymentStatus, createTicketReading, TableTicketStore, type PlateLookup } from '../src/server/modules/parking-and-prices/ticketing/index';
import { FixedClock } from '../src/server/shared/clock';
import { REQUEST_ID_HEADER } from '../src/server/shared/request-id';
import { fail, succeed } from '../src/server/shared/result';
import { bodyOf, bold, dim, expectThat, money, note, say, scene, showExchange, table, title } from './lib';

const clock = new FixedClock(new Date('2026-11-09T08:00:00Z'));
const hoursLater = (hours: number): void => clock.advanceByMilliseconds(hours * 60 * 60 * 1000);
const clockText = (): string => clock.now().toISOString().replace('.000Z', 'Z');

// --- the committee's published prices -------------------------------------------------------------------------------
const PRICES: readonly PriceVersion[] = [
  { versionId: 'price-1', siteId: 'site-1', firstHourFee: 10, eachLaterHourFee: 5, dailyCap: 50, validFrom: '2026-11-01T00:00:00.000Z' },
  { versionId: 'price-2', siteId: 'site-2', firstHourFee: 12, eachLaterHourFee: 6, dailyCap: 60, validFrom: '2026-11-01T00:00:00.000Z' },
  { versionId: 'price-3', siteId: 'site-3', firstHourFee: 13, eachLaterHourFee: 6, dailyCap: 60, validFrom: '2026-11-01T00:00:00.000Z' },
];

const PLATES = new Map([
  ['car-amira', 'ABC 123'],
  ['car-karim', 'DEF 456'],
  ['car-nour', 'GHI 789'],
  ['car-sara', 'JKL 321'],
  ['car-omar', 'MNO 654'],
]);
const RESIDENT_CARS = new Set(['car-nour']);

const plates: PlateLookup = {
  readPlate: async ({ carRef }) => {
    const plate = PLATES.get(carRef);
    return plate === undefined ? fail('not resolvable') : succeed(plate);
  },
};

// --- the application, composed the way the project's own payment tests compose it ----------------------------------
const store = new TableTicketStore();
const prices = createPriceList({ isApproved: () => true });
const fees = createFeeCalculator({ isResident: (carRef, siteId) => siteId === 'site-1' && RESIDENT_CARS.has(carRef) });
const gateway = createFakePaymentGateway();
const payments = createPayments({
  gateway,
  ticketDesk: createTicketPaymentStatus({ store }),
  ticketQuery: createTicketReading({ store, plates, fees }),
  clock,
});
const app = composeInMemoryApplication({
  tokenSecret: TEST_TOKEN_SECRET,
  clock,
  moduleDependencies: { prices, fees, plates, tickets: store },
  additionalOperations: payments.operations,
});

let requestCounter = 0;
const nextRequestId = (): string => `fee-demo-${String((requestCounter += 1)).padStart(4, '0')}`;

async function send(
  label: string,
  method: 'GET' | 'POST',
  path: string,
  person: string,
  options: { body?: unknown; query?: Record<string, string>; withRequestId?: boolean; quiet?: boolean } = {},
) {
  const headers: Record<string, string> = { authorization: `Bearer ${tokenFor('driver', { personId: person })}` };
  if (method === 'POST' || options.withRequestId === true) {
    headers[REQUEST_ID_HEADER] = nextRequestId();
  }
  const request: HttpRequest = {
    method,
    path,
    query: options.query ?? {},
    headers,
    address: TEST_ADDRESS,
    ...(options.body === undefined ? {} : { body: options.body }),
  };
  const response = await app.handle(request);
  if (options.quiet !== true) {
    showExchange(label, request, response);
  }
  return response;
}

interface TicketBody {
  readonly ticket: { readonly ticketId: string; readonly openedAt: string; readonly closedAt?: string; readonly fee?: number; readonly paymentStatus: string };
}

async function park(person: string, carRef: string, siteId: string): Promise<string> {
  const opened = await send(`${person} scans the entry sign at ${siteId}`, 'POST', '/tickets/open', person, {
    body: { siteId, carRef, entryCode: `entry-${siteId}` },
  });
  expectThat(opened.status === 201, `${person}: ticket opened at ${clockText()}`);
  return bodyOf<TicketBody>(opened).ticket.ticketId;
}

async function leave(person: string, ticketId: string, siteId: string) {
  return send(`${person} scans the exit sign`, 'POST', '/tickets/close', person, { body: { ticketId, exitCode: `exit-${siteId}` } });
}

async function main(): Promise<void> {
  title('DEMO 2  -  Leaving the street: server-side fees, payment and receipt');
  say('The clock is controlled by this script, so hours can pass in a second. Nothing about time or money');
  say('is ever sent by the phone: the server alone decides the exit time, the hours and the fee.');

  // ---------------------------------------------------------------------------------------------------------------
  scene(1, "The committee's price list (published by the committee; the system never sets a price)");
  for (const version of PRICES) {
    const applied = await prices.applyApprovedVersion(version, `approval-${version.versionId}`);
    expectThat(applied.applied, `Price applied for ${version.siteId}`);
  }
  table([
    ['site', '1st hour', 'each later hour', 'daily cap'],
    ...PRICES.map((version) => [version.siteId, money(version.firstHourFee), money(version.eachLaterHourFee), money(version.dailyCap)]),
  ]);
  note('Every started hour is charged. site-1 also has a resident exemption for registered residents.');

  // ---------------------------------------------------------------------------------------------------------------
  scene(2, 'Five drivers arrive at 08:00 at three different streets');
  const amira = await park('driver-amira', 'car-amira', 'site-1');
  const karim = await park('driver-karim', 'car-karim', 'site-1');
  const nour = await park('driver-nour', 'car-nour', 'site-1');
  const sara = await park('driver-sara', 'car-sara', 'site-2');
  const omar = await park('driver-omar', 'car-omar', 'site-3');

  // ---------------------------------------------------------------------------------------------------------------
  scene(3, 'One hour later: Sara leaves site-2. The first hour costs 12 EGP. She pays in the app: the card is declined');
  hoursLater(1);
  const saraExit = await leave('driver-sara', sara, 'site-2');
  expectThat(saraExit.status === 200 && bodyOf<TicketBody>(saraExit).ticket.fee === 12, 'Fee for 1 started hour at site-2 = 12 EGP');
  const saraPay = await send('Pay in the app', 'POST', '/payments/app', 'driver-sara', { body: { ticketId: sara } });
  expectThat(saraPay.status === 402 && bodyOf<{ error: string }>(saraPay).error === 'declined', 'The provider declined: the driver is told "declined" (HTTP 402)');
  const saraStatus = await send('Ticket status after the declined payment', 'GET', '/tickets/status', 'driver-sara', { query: { ticketId: sara } });
  expectThat(bodyOf<TicketBody>(saraStatus).ticket.paymentStatus === 'unpaid', 'The ticket stays unpaid (nothing is guessed, nothing is lost)');
  note('The fake payment provider is scripted by the last digit of the amount: ...1 paid, ...2 declined, ...3 pending.');

  // ---------------------------------------------------------------------------------------------------------------
  scene(4, 'Omar leaves site-3 (13 EGP). The provider answers "pending": the app says "pay later or pay cash"');
  const omarExit = await leave('driver-omar', omar, 'site-3');
  expectThat(omarExit.status === 200 && bodyOf<TicketBody>(omarExit).ticket.fee === 13, 'Fee for 1 started hour at site-3 = 13 EGP');
  const omarPay = await send('Pay in the app', 'POST', '/payments/app', 'driver-omar', { body: { ticketId: omar } });
  expectThat(omarPay.status === 202, 'A pending answer is recorded and polled later, never guessed (HTTP 202)');
  const omarAgain = await send('Omar taps "pay" again right away', 'POST', '/payments/app', 'driver-omar', { body: { ticketId: omar } });
  expectThat(omarAgain.status === 409, 'A ticket with a pending payment takes no second charge');

  // ---------------------------------------------------------------------------------------------------------------
  scene(5, 'At 11:20 Amira leaves site-1 after 3 h 20 min: 4 started hours = 10 + 5 + 5 + 5');
  hoursLater(2 + 20 / 60);
  const amiraExit = await leave('driver-amira', amira, 'site-1');
  const amiraTicket = bodyOf<TicketBody>(amiraExit).ticket;
  expectThat(amiraExit.status === 200 && amiraTicket.fee === 25, 'Fee = 25 EGP, computed by the server (Committee Prices module only)');
  expectThat(amiraTicket.closedAt === clock.now().toISOString(), 'The exit time is frozen at the server clock, not at the phone');
  const stolen = await send("Karim tries to pay Amira's ticket", 'POST', '/payments/app', 'driver-karim', { body: { ticketId: amira } });
  expectThat(stolen.status === 403, "Nobody can pay or touch someone else's ticket");
  const amiraPay = await send('Amira pays in the app', 'POST', '/payments/app', 'driver-amira', { body: { ticketId: amira } });
  expectThat(amiraPay.status === 201 && bodyOf<{ payment: { state: string } }>(amiraPay).payment.state === 'paid', 'Payment recorded as paid');
  const paidAgain = await send('Amira taps "pay" a second time (a new request)', 'POST', '/payments/app', 'driver-amira', { body: { ticketId: amira } });
  expectThat(paidAgain.status === 409 && bodyOf<{ error: string }>(paidAgain).error === 'nothing to pay', 'Nothing to pay: a ticket cannot be charged twice');
  const receipt = await send('Amira opens her receipt (showing a plate is a logged, role-checked read)', 'GET', '/tickets/receipt', 'driver-amira', {
    query: { ticketId: amira },
    withRequestId: true,
  });
  expectThat(bodyOf<{ receipt: { plate: string; hours: number; fee: number } }>(receipt).receipt.hours === 4, 'The receipt shows the 4 hours the fee was charged for');

  // ---------------------------------------------------------------------------------------------------------------
  scene(6, 'At 13:00 Nour, a registered resident of the street, leaves after 5 hours: 0 EGP');
  hoursLater(1 + 40 / 60);
  const nourExit = await leave('driver-nour', nour, 'site-1');
  expectThat(nourExit.status === 200 && bodyOf<TicketBody>(nourExit).ticket.fee === 0, 'Residents of the street do not pay');

  // ---------------------------------------------------------------------------------------------------------------
  scene(7, 'At 22:00 Karim, who forgot the time, leaves after 14 hours: the daily cap protects him');
  hoursLater(9);
  const karimExit = await leave('driver-karim', karim, 'site-1');
  const karimFee = bodyOf<TicketBody>(karimExit).ticket.fee;
  say(`Without a cap: 10 + 13 x 5 = 75 EGP.   With the committee's cap: ${bold(money(karimFee ?? -1))}`);
  expectThat(karimFee === 50, 'The fee never goes above the committee cap');

  // ---------------------------------------------------------------------------------------------------------------
  scene(8, 'Summary: what each driver was charged, straight from the tickets');
  const rows: string[][] = [['driver', 'site', 'opened', 'closed', 'fee', 'payment']];
  for (const [person, ticketId] of [
    ['driver-amira', amira],
    ['driver-karim', karim],
    ['driver-nour', nour],
    ['driver-sara', sara],
    ['driver-omar', omar],
  ] as const) {
    const status = await send('', 'GET', '/tickets/status', person, { query: { ticketId }, quiet: true });
    const ticket = bodyOf<{ ticket: { siteId: string; openedAt: string; closedAt: string; fee: number; paymentStatus: string } }>(status).ticket;
    rows.push([person, ticket.siteId, ticket.openedAt.slice(11, 16), ticket.closedAt.slice(11, 16), money(ticket.fee), ticket.paymentStatus]);
  }
  table(rows);
  note('Closed-ticket events went to the outbox in the same transaction as each close, ready for the delivery job.');
  const topics = new Map<string, number>();
  for (const event of app.outbox.allEvents()) {
    topics.set(event.topic, (topics.get(event.topic) ?? 0) + 1);
  }
  say(dim(`Events in the outbox: ${[...topics].map(([topic, count]) => `${count} x ${topic}`).join(', ')}`));

  console.log('');
  say(bold('Demo 2 complete.'));
}

await main();
