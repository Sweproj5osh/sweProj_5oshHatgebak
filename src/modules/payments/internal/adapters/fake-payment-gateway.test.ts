import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePaymentGateway } from '../../public';
import { outcomeForAmount } from './fake-payment-gateway';

/**
 * Task C1: the payment-provider port and a fake provider. The fake answers paid, declined, pending or times out,
 * chosen by the amount's last digit: 1 → paid, 2 → declined, 3 → pending, 9 → no answer for the whole timeout.
 */
const EIGHT_SECONDS = 8_000;

/** Pass or fail per branch, printed once at the end as the task's report. */
const branchResults: Record<'paid' | 'declined' | 'pending' | 'timeout', 'PASS' | 'FAIL'> = {
  paid: 'FAIL',
  declined: 'FAIL',
  pending: 'FAIL',
  timeout: 'FAIL',
};

describe('C1 the payment-provider port and the fake provider', () => {
  it('answers paid, with a provider reference, for an amount ending in 1', async () => {
    const gateway = createFakePaymentGateway();
    const result = await gateway.charge(11, 'request-paid-001', EIGHT_SECONDS);
    expect(result.outcome).toBe('paid');
    expect(result.providerReference).toMatch(/^fake-/);
    expect(await gateway.status(result.providerReference ?? '')).toBe('paid');
    branchResults.paid = 'PASS';
  });

  it('answers declined, with a provider reference, for an amount ending in 2', async () => {
    const gateway = createFakePaymentGateway();
    const result = await gateway.charge(12, 'request-declined-001', EIGHT_SECONDS);
    expect(result.outcome).toBe('declined');
    expect(result.providerReference).toMatch(/^fake-/);
    expect(await gateway.status(result.providerReference ?? '')).toBe('declined');
    branchResults.declined = 'PASS';
  });

  it('answers pending for an amount ending in 3, and reports pending until the provider settles it', async () => {
    const gateway = createFakePaymentGateway();
    const result = await gateway.charge(13, 'request-pending-001', EIGHT_SECONDS);
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

    it('gives no answer for the whole 8 seconds, then says timed out with no reference', async () => {
      const gateway = createFakePaymentGateway();
      let answered = false;
      const pendingCharge = gateway.charge(19, 'request-timeout-001', EIGHT_SECONDS).then((result) => {
        answered = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(EIGHT_SECONDS - 1);
      expect(answered).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const result = await pendingCharge;
      expect(answered).toBe(true);
      expect(result).toEqual({ outcome: 'timed out' });
      branchResults.timeout = 'PASS';
    });
  });

  it('answers paid for every other last digit, so the common path needs no special amount', () => {
    expect(outcomeForAmount(10)).toBe('paid');
    expect(outcomeForAmount(14)).toBe('paid');
    expect(outcomeForAmount(25)).toBe('paid');
    expect(outcomeForAmount(50)).toBe('paid');
    expect(outcomeForAmount(0)).toBe('paid');
  });

  it('judges the amount by its last whole-pound digit, including decimals and negatives', () => {
    expect(outcomeForAmount(11.5)).toBe('paid');
    expect(outcomeForAmount(12.25)).toBe('declined');
    expect(outcomeForAmount(103)).toBe('pending');
    expect(outcomeForAmount(-19)).toBe('timed out');
  });

  it('counts every charge call per idempotency key and repeats the first answer for a repeated key', async () => {
    const gateway = createFakePaymentGateway();
    const first = await gateway.charge(11, 'request-repeat-001', EIGHT_SECONDS);
    const second = await gateway.charge(11, 'request-repeat-001', EIGHT_SECONDS);
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
