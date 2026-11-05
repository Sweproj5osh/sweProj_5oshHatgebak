export type DriverScanAction = 'entry' | 'exit';

export interface DriverScanRequest {
  readonly requestId: string;
  readonly driverId: string;
  readonly siteId: string;
  readonly code: string;
  readonly action: DriverScanAction;
}

export type DriverScanSuccess = {
  readonly ok: true;
  readonly ticketId: string;
  readonly siteId: string;
  readonly driverId: string;
  readonly action: DriverScanAction;
  readonly status: 'opened' | 'closed';
};

export type DriverScanFailure = {
  readonly ok: false;
  readonly error: 'car already parked' | 'no open ticket' | 'forged code' | 'wrong site';
};

export type DriverScanResult = DriverScanSuccess | DriverScanFailure;

export interface DriverScanState {
  readonly activeTickets: Map<string, string>;
  readonly responses: Map<string, DriverScanResult>;
  nextTicketNumber: number;
}

export function createDriverScanState(): DriverScanState {
  return {
    activeTickets: new Map(),
    responses: new Map(),
    nextTicketNumber: 1,
  };
}

export function processDriverScan(state: DriverScanState, request: DriverScanRequest): DriverScanResult {
  const known = state.responses.get(request.requestId);
  if (known) {
    return known;
  }

  if (request.action === 'entry') {
    if (state.activeTickets.has(request.driverId)) {
      const result: DriverScanFailure = { ok: false, error: 'car already parked' };
      state.responses.set(request.requestId, result);
      return result;
    }

    const expectedCode = `entry-${request.siteId}`;
    if (request.code !== expectedCode) {
      const result: DriverScanFailure = { ok: false, error: request.code.startsWith('exit-') ? 'wrong site' : 'forged code' };
      state.responses.set(request.requestId, result);
      return result;
    }

    const ticketId = `ticket-${state.nextTicketNumber}`;
    state.nextTicketNumber += 1;
    const result: DriverScanSuccess = {
      ok: true,
      ticketId,
      siteId: request.siteId,
      driverId: request.driverId,
      action: 'entry',
      status: 'opened',
    };
    state.activeTickets.set(request.driverId, ticketId);
    state.responses.set(request.requestId, result);
    return result;
  }

  const openTicketId = state.activeTickets.get(request.driverId);
  if (!openTicketId) {
    const result: DriverScanFailure = { ok: false, error: 'no open ticket' };
    state.responses.set(request.requestId, result);
    return result;
  }

  const expectedCode = `exit-${request.siteId}`;
  if (request.code !== expectedCode) {
    const result: DriverScanFailure = { ok: false, error: request.code.startsWith('entry-') ? 'wrong site' : 'forged code' };
    state.responses.set(request.requestId, result);
    return result;
  }

  const result: DriverScanSuccess = {
    ok: true,
    ticketId: openTicketId,
    siteId: request.siteId,
    driverId: request.driverId,
    action: 'exit',
    status: 'closed',
  };
  state.activeTickets.delete(request.driverId);
  state.responses.set(request.requestId, result);
  return result;
}
