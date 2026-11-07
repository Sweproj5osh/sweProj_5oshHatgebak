import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePaymentGateway } from '../../public';
import { behaviourForAmount } from './fake-payment-gateway';

/**
 * Task C1: the payment-provider port and a fake provider. The fake answers paid, declined or pending, chosen by the
 * amount's last digit: 1 → paid, 2 → declined, 3 → pending, 9 → no answer for the ledger's whole 8-second timer, then
 * paid one second late (the adapter never times itself, P18: the timer is the ledger's).
 */
const EIGHT_SECONDS = 8_000;

/** Pass or fail per branch, printed once at the end as the task's report. */
const branchResults: Record<'paid' | 'declined' | 'pending' | 'slow', 'PASS' | 'FAIL'> = {
  paid: 'FAIL',
  declined: 'FAIL',
  pending: 'FAIL',
  slow: 'FAIL',
};

describe('C1 the payment-provider port and the fake provider', () => {
  it('answers paid, with a provider reference, for an amount ending in 1', async () => {
    const gateway = createFakePaymentGateway();
    const result = await gateway.charge(11, 'request-paid-001');
    expect(result.outcome).toBe('paid');
    expect(result.providerReference).toMatch(/^fake-/);
    expect(await gateway.status(result.providerReference ?? '')).toBe('paid');
    branchResults.paid = 'PASS';
  });

  it('answers declined, with a provider reference, for an amount ending in 2', async () => {
    const gateway = createFakePaymentGateway();
    const result = await gateway.charge(12, 'request-declined-001');
    expect(result.outcome).toBe('declined');
    expect(result.providerReference).toMatch(/^fake-/);
    expect(await gateway.status(result.providerReference ?? '')).toBe('declined');
    branchResults.declined = 'PASS';
  });

  it('answers pending for an amount ending in 3, and reports pending until the provider settles it', async () => {
    const gateway = createFakePaymentGateway();
    const result = await gateway.charge(13, 'request-pending-001');
    expect(result.outcome).toBe('pending');
    const reference = result.providerReference ?? '';
    expect(await gateway.status(reference)).toBe('pending');
    gateway.settle(reference, 'paid');
    expect(await gateway.status(reference)).toBe('paid');
    branchResults.pending = 'PASS';
  });

  describe('an amount ending in 9', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('gives no answer for the whole 8 seconds, then answers paid with a reference one second late', async () => {
      const gateway = createFakePaymentGateway();
      let answered = false;
      const slowCharge = gateway.charge(19, 'request-slow-001').then((result) => {
        answered = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(EIGHT_SECONDS);
      expect(answered).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      const result = await slowCharge;
      expect(answered).toBe(true);
      expect(result.outcome).toBe('paid');
      expect(result.providerReference).toMatch(/^fake-/);
      branchResults.slow = 'PASS';
    });

    it('already holds the slow charge, so the same key asked again answers at once with the same reference', async () => {
      const gateway = createFakePaymentGateway();
      const slowCharge = gateway.charge(19, 'request-slow-002');
      const askedAgain = await gateway.charge(19, 'request-slow-002');
      await vi.advanceTimersByTimeAsync(EIGHT_SECONDS + 1_000);
      expect(await slowCharge).toEqual(askedAgain);
    });
  });

  it('answers paid at once for every other last digit, so the common path needs no special amount', () => {
    for (const amount of [10, 14, 25, 50, 0]) {
      expect(behaviourForAmount(amount)).toEqual({ outcome: 'paid', answersLate: false });
    }
  });

  it('judges the amount by its last whole-pound digit, including decimals and negatives', () => {
    expect(behaviourForAmount(11.5).outcome).toBe('paid');
    expect(behaviourForAmount(12.25).outcome).toBe('declined');
    expect(behaviourForAmount(103).outcome).toBe('pending');
    expect(behaviourForAmount(-19)).toEqual({ outcome: 'paid', answersLate: true });
  });

  it('counts every charge call per idempotency key and repeats the first answer for a repeated key', async () => {
    const gateway = createFakePaymentGateway();
    const first = await gateway.charge(11, 'request-repeat-001');
    const second = await gateway.charge(11, 'request-repeat-001');
    expect(second).toEqual(first);
    expect(gateway.chargeCallCount('request-repeat-001')).toBe(2);
    expect(gateway.chargeCallCount('request-never-sent')).toBe(0);
    expect(gateway.chargeCallCount()).toBe(2);
  });

  it('refuses a status question about a reference it never issued', async () => {
    const gateway = createFakePaymentGateway();
    await expect(gateway.status('fake-unknown')).rejects.toThrow('No charge with the reference fake-unknown');
  });

  afterAll(() => {
    const report = Object.entries(branchResults)
      .map(([branch, result]) => `${branch} ${result}`)
      .join('; ');
    console.log(`C1 report: ${report}`);
  });
});
