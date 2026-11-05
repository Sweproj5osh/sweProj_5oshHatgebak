import { describe, expect, it } from 'vitest';
import { createSiteCodes } from '../public';

const TEST_SITE_CODE_SECRET = 'site-code-secret-for-tests';

/** Task A7: signed codes bound to one site; a forged or foreign code is recognised. */
describe('A7 site entry and exit codes', () => {
  const codes = createSiteCodes(TEST_SITE_CODE_SECRET);

  it('accepts the genuine entry and exit codes of a site at that site', async () => {
    const { entryCode, exitCode } = await codes.issueEntryAndExitCodes('site-1');
    expect(await codes.verifyEntryCode(entryCode, 'site-1')).toEqual({ ok: true, value: 'site-1' });
    expect(await codes.verifyExitCode(exitCode, 'site-1')).toEqual({ ok: true, value: 'site-1' });
  });

  it('calls a code with any single character changed "forged", at every position', async () => {
    const { entryCode } = await codes.issueEntryAndExitCodes('site-1');
    let attempted = 0;
    let detected = 0;
    for (let position = 0; position < entryCode.length; position += 1) {
      for (const replacement of ['A', 'z', '0', '-', '_']) {
        if (entryCode[position] === replacement) {
          continue;
        }
        const altered = entryCode.slice(0, position) + replacement + entryCode.slice(position + 1);
        attempted += 1;
        const verdict = await codes.verifyEntryCode(altered, 'site-1');
        if (!verdict.ok && verdict.error === 'forged') {
          detected += 1;
        }
      }
    }
    expect(detected).toBe(attempted);
    console.log(`A7 report: forgeries detected ${detected} / attempted ${attempted} (${((100 * detected) / attempted).toFixed(0)} %)`);
  });

  it('calls site 2\'s genuine code presented at site 1 "wrong site"', async () => {
    const siteTwo = await codes.issueEntryAndExitCodes('site-2');
    expect(await codes.verifyEntryCode(siteTwo.entryCode, 'site-1')).toEqual({ ok: false, error: 'wrong site' });
    expect(await codes.verifyExitCode(siteTwo.exitCode, 'site-1')).toEqual({ ok: false, error: 'wrong site' });
  });

  it('calls an exit code scanned at the entry "wrong kind"', async () => {
    const { exitCode } = await codes.issueEntryAndExitCodes('site-1');
    expect(await codes.verifyEntryCode(exitCode, 'site-1')).toEqual({ ok: false, error: 'wrong kind' });
  });

  it('calls a code signed with another secret, an empty code and nonsense "forged"', async () => {
    const foreign = await createSiteCodes('a-different-secret-entirely').issueEntryAndExitCodes('site-1');
    for (const code of [foreign.entryCode, '', 'hello', 'SAYES1.entry..', 'SAYES1.entry.c2l0ZS0x.x.y']) {
      expect(await codes.verifyEntryCode(code, 'site-1')).toEqual({ ok: false, error: 'forged' });
    }
  });

  it('refuses to start with a secret too short to be safe', () => {
    expect(() => createSiteCodes('short')).toThrow(/at least 16 characters/);
  });
});
