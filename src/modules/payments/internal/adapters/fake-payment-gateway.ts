import { randomUUID } from 'node:crypto';
import type { RequestId } from '../../../../shared/request-id';
import type { ChargeOutcome, ChargeResult, PaymentGateway } from '../../public';

/**
 * The stand-in for the outside payment provider (task C1, ADR-11). Every test and the in-memory server run on it;
 * the real adapter of task C18 replaces it by configuration only.
 *
 * The answer is chosen by the amount's last whole-pound digit: 1 → paid, 2 → declined, 3 → pending, 9 → no answer
 * until the caller's timeout passes, then "timed out". Every other digit is paid, so an ordinary fee needs no
 * special amount to succeed.
 */
export interface FakePaymentGateway extends PaymentGateway {
  /** How many times `charge` was called with this key, or in total when no key is given (task C3). */
  chargeCallCount(idempotencyKey?: RequestId): number;
  /** Change a recorded charge's outcome, the way the real provider later settles a pending payment (task C5). */
  settle(providerReference: string, outcome: ChargeOutcome): void;
}

/** What the fake remembers about one charge it accepted. */
interface RecordedCharge {
  readonly providerReference: string;
  readonly amount: number;
  readonly idempotencyKey: RequestId;
  readonly outcome: ChargeOutcome;
}

const OUTCOME_BY_LAST_DIGIT: Readonly<Record<number, ChargeOutcome>> = {
  1: 'paid',
  2: 'declined',
  3: 'pending',
  9: 'timed out',
};

const DEFAULT_OUTCOME: ChargeOutcome = 'paid';

/** The outcome the fake gives an amount, from its last whole-pound digit. */
export function outcomeForAmount(amount: number): ChargeOutcome {
  const lastDigit = Math.abs(Math.trunc(amount)) % 10;
  return OUTCOME_BY_LAST_DIGIT[lastDigit] ?? DEFAULT_OUTCOME;
}

/** Waits the given time. A plain timer so that tests can drive it with fake timers. */
function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class ScriptedPaymentGateway implements FakePaymentGateway {
  private readonly chargesByReference = new Map<string, RecordedCharge>();
  private readonly chargesByKey = new Map<RequestId, RecordedCharge>();
  private readonly callsByKey = new Map<RequestId, number>();
  private totalCalls = 0;

  async charge(amount: number, idempotencyKey: RequestId, timeoutMilliseconds: number): Promise<ChargeResult> {
    this.countCall(idempotencyKey);

    const alreadyCharged = this.chargesByKey.get(idempotencyKey);
    if (alreadyCharged !== undefined) {
      return toResult(alreadyCharged);
    }

    const outcome = outcomeForAmount(amount);
    if (outcome === 'timed out') {
      await wait(timeoutMilliseconds);
      return { outcome };
    }

    const charge: RecordedCharge = { providerReference: `fake-${randomUUID()}`, amount, idempotencyKey, outcome };
    this.chargesByReference.set(charge.providerReference, charge);
    this.chargesByKey.set(idempotencyKey, charge);
    return toResult(charge);
  }

  async status(providerReference: string): Promise<ChargeOutcome> {
    return this.existing(providerReference).outcome;
  }

  chargeCallCount(idempotencyKey?: RequestId): number {
    return idempotencyKey === undefined ? this.totalCalls : (this.callsByKey.get(idempotencyKey) ?? 0);
  }

  settle(providerReference: string, outcome: ChargeOutcome): void {
    const settled: RecordedCharge = { ...this.existing(providerReference), outcome };
    this.chargesByReference.set(providerReference, settled);
    this.chargesByKey.set(settled.idempotencyKey, settled);
  }

  private countCall(idempotencyKey: RequestId): void {
    this.totalCalls += 1;
    this.callsByKey.set(idempotencyKey, (this.callsByKey.get(idempotencyKey) ?? 0) + 1);
  }

  private existing(providerReference: string): RecordedCharge {
    const charge = this.chargesByReference.get(providerReference);
    if (charge === undefined) {
      throw new Error(`No charge with the reference ${providerReference}`);
    }
    return charge;
  }
}

function toResult(charge: RecordedCharge): ChargeResult {
  return { outcome: charge.outcome, providerReference: charge.providerReference };
}

export function createFakePaymentGateway(): FakePaymentGateway {
  return new ScriptedPaymentGateway();
}
