import { describe, expect, it } from 'vitest';
import {
  clockInAttendant,
  createAttendantModeState,
  listCarsWaitingForCash,
  listOpenTickets,
  markTicketPaid,
  openAssistedTicket,
} from './attendant-mode';

describe('D5 staff app attendant mode', () => {
  it('clocks in on the correct site and lists unpaid cars', () => {
    const state = createAttendantModeState();

    const signIn = clockInAttendant(state, {
      requestId: 'clock-1',
      attendantId: 'attendant-7',
      siteId: 'site-12',
      code: 'attendant-site-12',
    });

    expect(signIn.ok).toBe(true);
    expect(signIn.siteId).toBe('site-12');

    const unpaid = listOpenTickets(state, 'attendant-7');
    expect(unpaid).toEqual([]);
    expect(listCarsWaitingForCash(state, 'attendant-7')).toEqual([]);

    const added = openAssistedTicket(state, {
      requestId: 'assist-1',
      attendantId: 'attendant-7',
      siteId: 'site-12',
      driverId: 'driver-a',
      plate: 'ABC-111',
    });

    expect(added.ok).toBe(true);
    expect(added.assisted).toBe(true);
    expect(listOpenTickets(state, 'attendant-7')).toHaveLength(1);
    expect(listCarsWaitingForCash(state, 'attendant-7')).toEqual(['ABC-111']);
  });

  it('marks a ticket as paid in one tap and removes it from the open list', () => {
    const state = createAttendantModeState();

    clockInAttendant(state, {
      requestId: 'clock-2',
      attendantId: 'attendant-8',
      siteId: 'site-4',
      code: 'attendant-site-4',
    });

    const created = openAssistedTicket(state, {
      requestId: 'assist-2',
      attendantId: 'attendant-8',
      siteId: 'site-4',
      driverId: 'driver-b',
      plate: 'XYZ-222',
    });

    const paid = markTicketPaid(state, {
      requestId: 'pay-1',
      attendantId: 'attendant-8',
      ticketId: created.ticketId,
    });

    expect(paid.ok).toBe(true);
    expect(paid.paid).toBe(true);
    expect(listOpenTickets(state, 'attendant-8')).toEqual([]);

    const repeat = markTicketPaid(state, {
      requestId: 'pay-1',
      attendantId: 'attendant-8',
      ticketId: created.ticketId,
    });

    expect(repeat).toEqual(paid);
  });

  it('refuses a wrong site code and keeps the action idempotent for the same request', () => {
    const state = createAttendantModeState();

    const first = clockInAttendant(state, {
      requestId: 'clock-3',
      attendantId: 'attendant-9',
      siteId: 'site-9',
      code: 'wrong-code',
    });

    const second = clockInAttendant(state, {
      requestId: 'clock-3',
      attendantId: 'attendant-9',
      siteId: 'site-9',
      code: 'wrong-code',
    });

    expect(first.ok).toBe(false);
    expect(first.error).toBe('wrong site');
    expect(second).toEqual(first);
    expect(state.sessions.has('attendant-9')).toBe(false);
  });
});
