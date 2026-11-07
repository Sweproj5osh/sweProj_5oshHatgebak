import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Role } from '../../../../shared/identifiers';

/** The committee's second sign-in step (task A15): members and the Chair need a password as well as the phone code. */
export const COMMITTEE_ROLES: readonly Role[] = ['member', 'chair'];
export const MINIMUM_PASSWORD_LENGTH = 10;
/** scrypt is paid per byte of input; a longer password is refused before it is hashed (P23). */
export const MAXIMUM_PASSWORD_BYTES = 256;

const SALT_BYTES = 16;
const HASH_BYTES = 64;

const scryptAsync = promisify<string, string, number, Buffer>(scrypt);

export interface PasswordHash {
  readonly salt: string;
  readonly hash: string;
}

export function needsSecondStep(role: Role): boolean {
  return COMMITTEE_ROLES.includes(role);
}

export type PasswordLengthProblem = 'password too short' | 'password too long';

export function passwordLengthProblem(password: string): PasswordLengthProblem | undefined {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return 'password too short';
  }
  return Buffer.byteLength(password, 'utf8') > MAXIMUM_PASSWORD_BYTES ? 'password too long' : undefined;
}

/** Asynchronous scrypt from Node's built-in crypto, with a fresh random salt per password; the password itself is never kept. */
export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  return { salt, hash: (await scryptAsync(password, salt, HASH_BYTES)).toString('hex') };
}

export async function passwordMatches(password: string, stored: PasswordHash): Promise<boolean> {
  const presented = await scryptAsync(password, stored.salt, HASH_BYTES);
  const expected = Buffer.from(stored.hash, 'hex');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
