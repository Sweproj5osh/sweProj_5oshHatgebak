import type { ChargeOutcome, ChargeResult } from '../public';

/**
 * What the ledger makes of one call to the provider: a final answer, a provisional one, or no usable answer: the timer
 * fired, the adapter threw, or it let through an outcome outside paid, declined and pending (an adapter error, Rule B).
 * "No answer" is never guessed to be either: the attempt stays pending, the raw outcome is kept on the attempt row for
 * reconciliation, and the caller is never told the ticket is paid (P18).
 */
export type ProviderAnswer =
  | { readonly kind: 'paid'; readonly providerReference: string }
  | { readonly kind: 'declined'; readonly providerReference: string }
  | { readonly kind: 'pending'; readonly providerReference: string }
  | { readonly kind: 'no answer'; readonly rawOutcome: string };

export const TIMED_OUT = 'timed out';

const KNOWN_OUTCOMES: readonly ChargeOutcome[] = ['paid', 'declined', 'pending'];

/** Asks the provider and gives up after the timeout: the timer is the ledger's, not the adapter's (P18, task C4). */
export async function askProvider(call: () => Promise<ChargeResult>, timeoutMilliseconds: number): Promise<ProviderAnswer> {
  try {
    const result = await firstToSettle(call(), timeoutMilliseconds);
    return result === TIMED_OUT ? { kind: 'no answer', rawOutcome: TIMED_OUT } : toAnswer(result);
  } catch (error) {
    return { kind: 'no answer', rawOutcome: `provider error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The adapter's result checked at run time: a real adapter may let the provider's own words through. */
function toAnswer(result: ChargeResult): ProviderAnswer {
  if (!isKnownOutcome(result.outcome)) {
    return { kind: 'no answer', rawOutcome: String(result.outcome) };
  }
  if (result.providerReference === undefined) {
    return { kind: 'no answer', rawOutcome: `${result.outcome} without a provider reference` };
  }
  return { kind: result.outcome, providerReference: result.providerReference };
}

function isKnownOutcome(outcome: unknown): outcome is ChargeOutcome {
  return typeof outcome === 'string' && (KNOWN_OUTCOMES as readonly string[]).includes(outcome);
}

/** The call's result, or TIMED_OUT once the timer fires first; a call that wins clears the timer. */
function firstToSettle<Value>(call: Promise<Value>, timeoutMilliseconds: number): Promise<Value | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), timeoutMilliseconds);
    call.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
