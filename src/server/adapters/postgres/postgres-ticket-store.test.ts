import { describe, expect, it } from 'vitest';
import { testApplication, writeRequest } from '../../test-support/test-helpers';

/**
 * F3 across transactions (task B6, Rule E): twenty drivers send their entry scan at the same instant, each in its own
 * request and so its own unit of work, for a site with five spaces (the test application's stand-in capacity). The
 * site lock of the PostgreSQL ticket store lets exactly five through; the in-memory store never could.
 */
describe('B6 the last-space rule across separate transactions (F3, PostgreSQL site lock)', () => {
  it('opens exactly 5 tickets for 20 simultaneous separate opens on 5 spaces, run after run', async () => {
    const issuedPerRun: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const application = testApplication();
      const answers = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          application.handle(
            writeRequest('/tickets', 'driver', `race-request-${run}-${index}`, { siteId: 'site-1', carRef: `car-${index}`, entryCode: 'entry-site-1' }),
          ),
        ),
      );
      issuedPerRun.push(answers.filter((answer) => answer.status === 201).length);
      expect(answers.filter((answer) => answer.status === 409)).toHaveLength(15);
      expect(await application.moduleDependencies.tickets.countOpen(application.database, 'site-1')).toBe(5);
      await application.database.close();
    }
    console.log(`B6 report (separate transactions): tickets per run ${issuedPerRun.join(' ')}`);
    expect(issuedPerRun).toEqual([5, 5, 5, 5, 5]);
  });
});
