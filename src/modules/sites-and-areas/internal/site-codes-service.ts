import type { SiteId } from '../../../shared/identifiers';
import type { Result } from '../../../shared/result';
import type { SiteCodeRefusal, SiteCodes } from '../public';
import type { SiteCodeSigner } from './domain/site-code-signer';

/** Issues and checks the signed entry and exit codes printed at each site (task A7). */
export class SiteCodesService implements SiteCodes {
  constructor(private readonly signer: SiteCodeSigner) {}

  async issueEntryAndExitCodes(siteId: SiteId): Promise<{ entryCode: string; exitCode: string }> {
    return { entryCode: this.signer.sign(siteId, 'entry'), exitCode: this.signer.sign(siteId, 'exit') };
  }

  async verifyEntryCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeRefusal>> {
    return this.signer.verify(code, siteId, 'entry');
  }

  async verifyExitCode(code: string, siteId: SiteId): Promise<Result<SiteId, SiteCodeRefusal>> {
    return this.signer.verify(code, siteId, 'exit');
  }
}
