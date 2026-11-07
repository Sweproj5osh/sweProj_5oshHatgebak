import { describe, expect, it } from 'vitest';
import { createTicketReading, PLATE_UNAVAILABLE, TicketReadRefusal } from '../public';
import { ATTENDANT_AT_SITE_1, FakePlates, assistedCommand, buildTicketingWorld, openCommand, START } from './testing/ticketing-world';

const HOUR = 60 * 60 * 1000;

async function world() {
  const built = await buildTicketingWorld();
  const plates = new FakePlates().withPlate('car-a', 'ABC 123');
  const reading = createTicketReading({ store: built.store, plates, fees: { startedHours: (entry, exit) => built.fees.startedHours(entry, exit) } });
  return { ...built, plates, reading };
}

type World = Awaited<ReturnType<typeof world>>;

async function openFor(w: World, driverRef: string, carRef: string) {
  const opened = await w.openTicket(openCommand({ driverRef, carRef }));
  if (!opened.ok) throw new Error('open failed');
  return opened.value;
}

describe('B12 ticket status and history', () => {
  it('lists a driver’s tickets newest first, with state and payment status', async () => {
    const w = await world();
    const first = await openFor(w, 'driver-1', 'car-a');
    w.clock.advanceByMilliseconds(HOUR);
    const second = await openFor(w, 'driver-1', 'car-b');
    const history = await w.reading.ticketHistory(w.database, 'driver-1');
    expect(history.map((ticket) => ticket.ticketId)).toEqual([second.ticketId, first.ticketId]);
    expect(history[0]).toMatchObject({ state: 'open', paymentStatus: 'unpaid' });
  });

  it('leaves out other drivers’ tickets, and gives an empty list to a driver with none', async () => {
    const w = await world();
    await openFor(w, 'driver-1', 'car-a');
    await openFor(w, 'driver-2', 'car-b');
    expect((await w.reading.ticketHistory(w.database, 'driver-1')).map((ticket) => ticket.driverRef)).toEqual(['driver-1']);
    expect(await w.reading.ticketHistory(w.database, 'driver-3')).toEqual([]);
  });

  it('shows one ticket exactly as it is stored', async () => {
    const w = await world();
    const ticket = await openFor(w, 'driver-1', 'car-a');
    expect(await w.reading.ticketStatus(w.database, ticket.ticketId)).toEqual(await w.findById(ticket.ticketId));
  });

  it('shows the new values in the list and the detail after a close and a payment change', async () => {
    const w = await world();
    const ticket = await openFor(w, 'driver-1', 'car-a');
    w.clock.advanceByMilliseconds(2 * HOUR);
    await w.closeTicket('close-request-1', ticket.ticketId, 'exit-site-1');
    await w.changePaymentStatus('payment-request-1', ticket.ticketId, 'paid');
    const expected = { state: 'closed', paymentStatus: 'paid', fee: 15 };
    expect(await w.reading.ticketStatus(w.database, ticket.ticketId)).toMatchObject(expected);
    expect((await w.reading.ticketHistory(w.database, 'driver-1'))[0]).toMatchObject(expected);
  });

  it('fails clearly for an unknown ticket', async () => {
    const w = await world();
    await expect(w.reading.ticketStatus(w.database, 'no-such-ticket')).rejects.toMatchObject({ reason: 'unknown ticket' });
    await expect(w.reading.ticketStatus(w.database, 'no-such-ticket')).rejects.toBeInstanceOf(TicketReadRefusal);
  });
});

describe('B13 the receipt', () => {
  async function closed(w: World, carRef = 'car-a', stayMinutes = 130) {
    const ticket = await openFor(w, 'driver-1', carRef);
    w.clock.advanceByMilliseconds(stayMinutes * 60 * 1000);
    await w.closeTicket(`close-${carRef}`, ticket.ticketId, 'exit-site-1');
    return ticket;
  }

  it('has every field: ticket, site, times, hours, fee and plate', async () => {
    const w = await world();
    const ticket = await closed(w);
    expect(await w.reading.receipt(w.database, ticket.ticketId, 'driver-1')).toEqual({
      ticketId: ticket.ticketId,
      siteId: 'site-1',
      openedAt: START.toISOString(),
      closedAt: new Date(START.getTime() + 130 * 60 * 1000).toISOString(),
      hours: 3,
      fee: 20,
      plate: 'ABC 123',
    });
  });

  it('asks for the plate exactly once, for the receipt, naming the car, the reader and the site', async () => {
    const w = await world();
    const ticket = await closed(w);
    await w.reading.receipt(w.database, ticket.ticketId, 'driver-1');
    expect(w.plates.requests).toEqual([{ carRef: 'car-a', reader: 'driver-1', purpose: 'receipt', siteId: 'site-1' }]);
  });

  it('charges hours that agree with the fee for several stays', async () => {
    for (const [minutes, hours, fee] of [[30, 1, 10], [60, 1, 10], [61, 2, 15], [130, 3, 20]] as const) {
      const w = await world();
      const ticket = await closed(w, 'car-a', minutes);
      expect(await w.reading.receipt(w.database, ticket.ticketId, 'driver-1')).toMatchObject({ hours, fee });
    }
  });

  it('has no receipt for a ticket that is still open, and asks for no plate', async () => {
    const w = await world();
    const ticket = await openFor(w, 'driver-1', 'car-a');
    await expect(w.reading.receipt(w.database, ticket.ticketId, 'driver-1')).rejects.toMatchObject({ reason: 'ticket not closed' });
    expect(w.plates.requests).toHaveLength(0);
  });

  it('refuses the receipt when the identity area refuses the reader, and shows no plate', async () => {
    const w = await world();
    const ticket = await closed(w);
    w.plates.refuse('stranger-1');
    await expect(w.reading.receipt(w.database, ticket.ticketId, 'stranger-1')).rejects.toMatchObject({ reason: 'plate read refused' });
  });

  it('still issues the receipt, with the plate marked unavailable, when the owner was erased', async () => {
    const w = await world();
    const ticket = await closed(w, 'car-erased');
    expect(await w.reading.receipt(w.database, ticket.ticketId, 'driver-1')).toMatchObject({ plate: PLATE_UNAVAILABLE, fee: 20 });
  });

  it('fails clearly for an unknown ticket', async () => {
    const w = await world();
    await expect(w.reading.receipt(w.database, 'no-such-ticket', 'driver-1')).rejects.toMatchObject({ reason: 'unknown ticket' });
  });

  it('keeps no plate in the stored ticket', async () => {
    const w = await world();
    const ticket = await closed(w);
    await w.reading.receipt(w.database, ticket.ticketId, 'driver-1');
    expect(JSON.stringify(await w.findById(ticket.ticketId))).not.toContain('ABC 123');
  });

  it('works for an assisted ticket read by the attendant', async () => {
    const w = await world();
    w.plates.withPlate('car-walk', 'WALK 1');
    const opened = await w.openAssistedTicket(assistedCommand({ carRef: 'car-walk' }), ATTENDANT_AT_SITE_1);
    if (!opened.ok) throw new Error('open failed');
    w.clock.advanceByMilliseconds(HOUR);
    await w.closeAssistedTicket('close-request-1', opened.value.ticketId, 'exit-site-1', ATTENDANT_AT_SITE_1, 'car-walk');
    expect(await w.reading.receipt(w.database, opened.value.ticketId, 'attendant-1')).toMatchObject({ plate: 'WALK 1', hours: 1, fee: 10 });
  });
});
