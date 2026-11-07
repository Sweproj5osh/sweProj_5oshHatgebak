import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** The sign-in policy of task A1, in one place for review and for the report. */
export const SIGN_IN_POLICY = {
  codeDigits: 6,
  codeLifetimeMinutes: 5,
  wrongCodesBeforeLockOut: 3,
  lockOutMinutes: 15,
} as const;

/** Keeps a code's hash from being mistaken for any other HMAC the same secret keys. */
const CODE_HASH_PURPOSE = 'sign-in-code';

export function newOneTimeCode(): string {
  return String(randomInt(0, 10 ** SIGN_IN_POLICY.codeDigits)).padStart(SIGN_IN_POLICY.codeDigits, '0');
}

/**
 * The hash kept in place of the code: an HMAC keyed with a server secret (P23), so a copy of the table alone cannot be
 * brute-forced through the million possible codes; the phone is in the message so equal codes never share a hash.
 */
export function hashOfCode(secret: string, phone: string, code: string): string {
  return createHmac('sha256', secret).update(`${CODE_HASH_PURPOSE}:${phone}:${code}`).digest('hex');
}

export function codeMatches(secret: string, phone: string, presentedCode: string, storedHash: string): boolean {
  const presented = Buffer.from(hashOfCode(secret, phone, presentedCode), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

export function minutesAfter(moment: Date, minutes: number): Date {
  return new Date(moment.getTime() + minutes * 60_000);
}
