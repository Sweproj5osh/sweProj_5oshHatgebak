import type { RateLimit } from '../shared/rate-limiter';

const TEN_MINUTES = 10 * 60 * 1000;

/** Public operations (ADR-15): a phone, or whatever body field the operation names, may try five times in ten minutes. */
export const PUBLIC_ATTEMPTS_PER_KEY: RateLimit = { maximumAttempts: 5, windowMilliseconds: TEN_MINUTES };

/** Public operations (ADR-15): one client address may try thirty times in ten minutes, whatever the phones. */
export const PUBLIC_ATTEMPTS_PER_ADDRESS: RateLimit = { maximumAttempts: 30, windowMilliseconds: TEN_MINUTES };

const ONE_MINUTE = 60 * 1000;

/** Telemetry (P7): one reading per person per minute keeps a flood of measurements off the server. */
export const TELEMETRY_READINGS_PER_PERSON: RateLimit = { maximumAttempts: 1, windowMilliseconds: ONE_MINUTE };

export const TOO_MANY_ATTEMPTS = 'too many attempts; wait a few minutes and try again';
