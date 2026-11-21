/**
 * KNOWN GAP (not part of the presentation demos): two or more SEPARATE requests that arrive at the same instant can
 * all take "the last space".
 *
 * Why: the ticket store's contract (src/modules/ticketing/internal/ticket-store.ts) says the PostgreSQL adapter must
 * lock the site inside each transaction, because two transactions do not see each other's uncommitted tickets. The
 * repository has no PostgreSQL adapter yet (src/adapters holds only in-memory code), and the in-memory database does
 * not lock across transactions. The project's F3 test (last-space.test.ts) races 20 opens inside ONE unit of work,
 * which passes; this script races 20 separate requests through the entry point, which is what real traffic looks like.
 *
 * Run from the repository root:   npx tsx demo/known-gap-parallel-requests.ts
 * It prints how many tickets were issued for 5 spaces over 30 independent runs. It never changes src/.
 */
import { composeInMemoryApplication } from '../src/entrypoint/composition';
import { TEST_ADDRESS, TEST_TOKEN_SECRET, tokenFor } from '../src/entrypoint/test-helpers';
import { REQUEST_ID_HEADER } from '../src/shared/request-id';
import { bold, say, title } from './lib';

const RUNS = 30;
const CAPACITY = 5;

async function oneRun(): Promise<number> {
  const app = composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET });
  const answers = await Promise.all(
    Array.from({ length: 20 }, (_, index) => {
      const number = String(index + 1).padStart(2, '0');
      return app.handle({
        method: 'POST',
        path: '/tickets/open',
        query: {},
        headers: { authorization: `Bearer ${tokenFor('driver', { personId: `driver-${number}` })}`, [REQUEST_ID_HEADER]: `gap-request-${number}` },
        address: TEST_ADDRESS,
        body: { siteId: 'site-1', carRef: `car-${number}`, entryCode: 'entry-site-1' },
      });
    }),
  );
  return answers.filter((answer) => answer.status === 201).length;
}

title('KNOWN GAP  -  20 separate simultaneous requests for 5 spaces');
const issued: number[] = [];
for (let run = 0; run < RUNS; run += 1) {
  issued.push(await oneRun());
}
const overIssued = issued.filter((count) => count > CAPACITY).length;
say(`Tickets issued per run (${RUNS} runs, capacity ${CAPACITY}): ${issued.join(' ')}`);
say(`Runs that issued more tickets than spaces: ${bold(`${overIssued} of ${RUNS}`)}   (most in one run: ${Math.max(...issued)})`);
say('Rule E / fitness function F3 require exactly 5. The fix is the per-site lock the TicketStore contract already describes.');
process.exitCode = overIssued === 0 ? 0 : 2;
