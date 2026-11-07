import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SiteId } from '../../../../shared/identifiers';
import { fail, succeed, type Result } from '../../../../shared/result';
import type { SiteCodeKind, SiteCodeRefusal } from '../../public';

/**
 * The text printed in a site's entry or exit QR code (task A7):
 * "SAYES1" . kind . base64url(site id) . base64url(HMAC-SHA256 of the first three parts).
 * The signature is computed and compared over the exact text presented, so changing any single character breaks it.
 */
const CODE_PREFIX = 'SAYES1';
const SEPARATOR = '.';
const MINIMUM_SECRET_LENGTH = 16;
const CODE_KINDS: readonly SiteCodeKind[] = ['entry', 'exit'];

export class SiteCodeSigner {
  constructor(private readonly secret: string) {
    if (secret.length < MINIMUM_SECRET_LENGTH) {
      throw new Error(`The site-code secret must be at least ${MINIMUM_SECRET_LENGTH} characters long`);
    }
  }

  sign(siteId: SiteId, kind: SiteCodeKind): string {
    const signedPart = [CODE_PREFIX, kind, Buffer.from(siteId, 'utf8').toString('base64url')].join(SEPARATOR);
    return `${signedPart}${SEPARATOR}${this.signatureOf(signedPart)}`;
  }

  /** "forged" when the code was not signed by this system; "wrong site" or "wrong kind" when it is genuine but misplaced. */
  verify(code: string, expectedSiteId: SiteId, expectedKind: SiteCodeKind): Result<SiteId, SiteCodeRefusal> {
    const parts = code.split(SEPARATOR);
    const [prefix, kind, encodedSiteId, providedSignature] = parts;
    if (parts.length !== 4 || prefix !== CODE_PREFIX || encodedSiteId === undefined || providedSignature === undefined) {
      return fail('forged');
    }
    const signedPart = [prefix, kind, encodedSiteId].join(SEPARATOR);
    if (!sameText(providedSignature, this.signatureOf(signedPart)) || !isCodeKind(kind)) {
      return fail('forged');
    }
    if (kind !== expectedKind) {
      return fail('wrong kind');
    }
    const siteId = Buffer.from(encodedSiteId, 'base64url').toString('utf8');
    return siteId === expectedSiteId ? succeed(siteId) : fail('wrong site');
  }

  private signatureOf(signedPart: string): string {
    return createHmac('sha256', this.secret).update(signedPart).digest('base64url');
  }
}

function isCodeKind(candidate: string | undefined): candidate is SiteCodeKind {
  return (CODE_KINDS as readonly (string | undefined)[]).includes(candidate);
}

/** Constant-time comparison of the presented text, so a timing difference never reveals how much of it was right. */
function sameText(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}
