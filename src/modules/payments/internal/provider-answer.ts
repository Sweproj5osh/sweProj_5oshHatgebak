import type { ChargeResult } from '../public';

/**
 * What the ledger makes of one call to the provider: a final answer, a provisional one, or no usable answer within
 * the ledger's timer. "No answer" is never guessed to be either: the attempt stays pending until reconciliation (P18).
 */
export type ProviderAnswer =
  | { readonly kind: 'paid'; readonly providerReference: string }
  | { readonly kind: 'declined'; readonly providerReference: string }
  | { readonly kind: 'pending'; readonly providerReference: string }
  | { readonly kind: 'no answer'; readonly rawOutcome: string };

export const TIMED_OUT = 'timed out';

/** Asks the provider and gives up after the timeout: the timer is the ledger's, not the adapter's (P18, task C4). */
export async function askProvider(call: () => Promise<ChargeResult>, timeoutMilliseconds: number): Promise<ProviderAnswer> {
  const result = await firstToSettle(call(), timeoutMilliseconds);
  if (result === TIMED_OUT) {
    return { kind: 'no answer', rawOutcome: TIMED_OUT };
  }
  return toAnswer(result);
}

function toAnswer(result: ChargeResult): ProviderAnswer {
  if (result.providerReference === undefined) {
    return { kind: 'no answer', rawOutcome: `${result.outcome} without a provider reference` };
  }
  return { kind: result.outcome, providerReference: result.providerReference };
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
