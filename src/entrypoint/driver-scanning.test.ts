import { describe, expect, it } from 'vitest';
import { createDriverScanState, processDriverScan } from './driver-scanning';

describe('D3 driver app scanning', () => {
  it('deduplicates the same request id and returns the same result twice', () => {
    const state = createDriverScanState();

    const first = processDriverScan(state, {
      requestId: 'scan-1',
      driverId: 'driver-1',
      siteId: 'site-7',
      code: 'entry-site-7',
      action: 'entry',
    });

    const second = processDriverScan(state, {
      requestId: 'scan-1',
      driverId: 'driver-1',
      siteId: 'site-7',
      code: 'entry-site-7',
      action: 'entry',
    });

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    expect(state.responses.size).toBe(1);
    expect(state.activeTickets.get('driver-1')).toBe('ticket-1');
  });

  it('keeps one active ticket when a retry follows a temporary network failure', () => {
    const state = createDriverScanState();

    const first = processDriverScan(state, {
      requestId: 'scan-2',
      driverId: 'driver-2',
      siteId: 'site-9',
      code: 'entry-site-9',
      action: 'entry',
    });

    const retry = processDriverScan(state, {
      requestId: 'scan-3',
      driverId: 'driver-2',
      siteId: 'site-9',
      code: 'entry-site-9',
      action: 'entry',
    });

    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(false);
    expect(retry.error).toBe('car already parked');
    expect(state.activeTickets.size).toBe(1);
  });

  it('closes the active ticket when the exit scan arrives and keeps the close result idempotent', () => {
    const state = createDriverScanState();

    processDriverScan(state, {
      requestId: 'scan-4',
      driverId: 'driver-3',
      siteId: 'site-4',
      code: 'entry-site-4',
      action: 'entry',
    });

    const close = processDriverScan(state, {
      requestId: 'scan-5',
      driverId: 'driver-3',
      siteId: 'site-4',
      code: 'exit-site-4',
      action: 'exit',
    });

    const repeatClose = processDriverScan(state, {
      requestId: 'scan-5',
      driverId: 'driver-3',
      siteId: 'site-4',
      code: 'exit-site-4',
      action: 'exit',
    });

    expect(close.ok).toBe(true);
    expect(repeatClose).toEqual(close);
    expect(state.activeTickets.has('driver-3')).toBe(false);
    expect(state.responses.size).toBe(2);
  });
});
