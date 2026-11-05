export interface AttendantClockInRequest {
  readonly requestId: string;
  readonly attendantId: string;
  readonly siteId: string;
  readonly code: string;
}

export type AttendantClockInSuccess = {
  readonly ok: true;
  readonly requestId: string;
  readonly attendantId: string;
  readonly siteId: string;
};

export type AttendantClockInFailure = {
  readonly ok: false;
  readonly requestId: string;
  readonly error: 'wrong site';
};

export type AttendantClockInResult = AttendantClockInSuccess | AttendantClockInFailure;

export interface TicketSummary {
  readonly ticketId: string;
  readonly driverId: string;
  readonly siteId: string;
  readonly plate: string;
  readonly paid: boolean;
  readonly assisted: boolean;
}

export interface AssistedTicketRequest {
  readonly requestId: string;
  readonly attendantId: string;
  readonly siteId: string;
  readonly driverId: string;
  readonly plate: string;
}

export type AssistedTicketSuccess = {
  readonly ok: true;
  readonly requestId: string;
  readonly ticketId: string;
  readonly driverId: string;
  readonly siteId: string;
  readonly plate: string;
  readonly paid: boolean;
  readonly assisted: boolean;
};

export type AssistedTicketFailure = {
  readonly ok: false;
  readonly requestId: string;
  readonly error: 'not clocked in' | 'wrong site';
};

export type AssistedTicketResult = AssistedTicketSuccess | AssistedTicketFailure;

export interface MarkPaidRequest {
  readonly requestId: string;
  readonly attendantId: string;
  readonly ticketId: string;
}

export type MarkPaidSuccess = {
  readonly ok: true;
  readonly requestId: string;
  readonly ticketId: string;
  readonly paid: boolean;
};

export type MarkPaidFailure = {
  readonly ok: false;
  readonly requestId: string;
  readonly error: 'not clocked in' | 'ticket not found';
};

export type MarkPaidResult = MarkPaidSuccess | MarkPaidFailure;

export interface AttendantModeState {
  readonly sessions: Map<string, string>;
  readonly tickets: Map<string, TicketSummary>;
  readonly clockResponses: Map<string, AttendantClockInResult>;
  readonly assistedResponses: Map<string, AssistedTicketResult>;
  readonly paidResponses: Map<string, MarkPaidResult>;
  nextTicketNumber: number;
}

export function createAttendantModeState(): AttendantModeState {
  return {
    sessions: new Map(),
    tickets: new Map(),
    clockResponses: new Map(),
    assistedResponses: new Map(),
    paidResponses: new Map(),
    nextTicketNumber: 1,
  };
}

export function clockInAttendant(
  state: AttendantModeState,
  request: AttendantClockInRequest,
): AttendantClockInResult {
  const known = state.clockResponses.get(request.requestId);
  if (known) {
    return known;
  }

  const expectedCode = `attendant-${request.siteId}`;
  if (request.code !== expectedCode) {
    const failure: AttendantClockInFailure = {
      ok: false,
      requestId: request.requestId,
      error: 'wrong site',
    };
    state.clockResponses.set(request.requestId, failure);
    return failure;
  }

  state.sessions.set(request.attendantId, request.siteId);
  const success: AttendantClockInSuccess = {
    ok: true,
    requestId: request.requestId,
    attendantId: request.attendantId,
    siteId: request.siteId,
  };
  state.clockResponses.set(request.requestId, success);
  return success;
}

export function listOpenTickets(state: AttendantModeState, attendantId: string): TicketSummary[] {
  const siteId = state.sessions.get(attendantId);
  if (siteId === undefined) {
    return [];
  }

  return [...state.tickets.values()].filter((ticket) => ticket.siteId === siteId && !ticket.paid);
}

export function listCarsWaitingForCash(state: AttendantModeState, attendantId: string): string[] {
  return listOpenTickets(state, attendantId).map((ticket) => ticket.plate);
}

export function openAssistedTicket(
  state: AttendantModeState,
  request: AssistedTicketRequest,
): AssistedTicketResult {
  const known = state.assistedResponses.get(request.requestId);
  if (known) {
    return known;
  }

  const siteId = state.sessions.get(request.attendantId);
  if (siteId === undefined) {
    const failure: AssistedTicketFailure = {
      ok: false,
      requestId: request.requestId,
      error: 'not clocked in',
    };
    state.assistedResponses.set(request.requestId, failure);
    return failure;
  }

  if (siteId !== request.siteId) {
    const failure: AssistedTicketFailure = {
      ok: false,
      requestId: request.requestId,
      error: 'wrong site',
    };
    state.assistedResponses.set(request.requestId, failure);
    return failure;
  }

  const ticketId = `ticket-${state.nextTicketNumber}`;
  state.nextTicketNumber += 1;
  const summary: TicketSummary = {
    ticketId,
    driverId: request.driverId,
    siteId: request.siteId,
    plate: request.plate,
    paid: false,
    assisted: true,
  };
  state.tickets.set(ticketId, summary);

  const success: AssistedTicketSuccess = {
    ok: true,
    requestId: request.requestId,
    ticketId,
    driverId: request.driverId,
    siteId: request.siteId,
    plate: request.plate,
    paid: false,
    assisted: true,
  };

  state.assistedResponses.set(request.requestId, success);
  return success;
}

export function markTicketPaid(state: AttendantModeState, request: MarkPaidRequest): MarkPaidResult {
  const known = state.paidResponses.get(request.requestId);
  if (known) {
    return known;
  }

  const siteId = state.sessions.get(request.attendantId);
  if (siteId === undefined) {
    const failure: MarkPaidFailure = {
      ok: false,
      requestId: request.requestId,
      error: 'not clocked in',
    };
    state.paidResponses.set(request.requestId, failure);
    return failure;
  }

  const ticket = state.tickets.get(request.ticketId);
  if (ticket === undefined || ticket.siteId !== siteId) {
    const failure: MarkPaidFailure = {
      ok: false,
      requestId: request.requestId,
      error: 'ticket not found',
    };
    state.paidResponses.set(request.requestId, failure);
    return failure;
  }

  if (ticket.paid) {
    const success: MarkPaidSuccess = {
      ok: true,
      requestId: request.requestId,
      ticketId: request.ticketId,
      paid: true,
    };
    state.paidResponses.set(request.requestId, success);
    return success;
  }

  const updated: TicketSummary = { ...ticket, paid: true };
  state.tickets.set(request.ticketId, updated);

  const success: MarkPaidSuccess = {
    ok: true,
    requestId: request.requestId,
    ticketId: request.ticketId,
    paid: true,
  };

  state.paidResponses.set(request.requestId, success);
  return success;
}
