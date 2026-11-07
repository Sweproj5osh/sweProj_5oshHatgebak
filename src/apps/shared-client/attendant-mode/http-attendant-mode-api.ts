/**
 * AttendantModeApi adapter: the Staff App talks to the main system only through the HTTP entry point.
 * The server's refusal is read from the `error` word; the app never decides whether a site or ticket is valid.
 */
import type { RequestId } from '../../../shared/request-id';
import { asRecord, requiredBoolean, requiredList, requiredString, type ServerAnswer } from '../server-answer';
import { ServerCall, ServerRefusedError, UNAUTHORIZED, type EntryPointHandle } from '../server-call';
import {
  AttendantModeRefusedError,
  isAttendantModeRefusal,
  type AssistedTicketInput,
  type AssistedTicketResult,
  type AttendantClockInResult,
  type AttendantModeApi,
  type MarkPaidResult,
  type TicketSummary,
} from './attendant-mode-api';
import {
  ATTENDANT_ASSISTED_TICKET_PATH,
  ATTENDANT_CARS_WAITING_FOR_CASH_PATH,
  ATTENDANT_CLOCK_IN_PATH,
  ATTENDANT_OPEN_TICKETS_PATH,
  ATTENDANT_TICK_CASH_PATH,
} from './attendant-mode-routes';

export interface HttpAttendantModeApiOptions {
  readonly handle: EntryPointHandle;
  /** The signed-in attendant's token. */
  readonly token: () => string | undefined;
}

export class HttpAttendantModeApi implements AttendantModeApi {
  private readonly server: ServerCall;

  constructor(options: HttpAttendantModeApiOptions) {
    this.server = new ServerCall({ handle: options.handle, token: options.token });
  }

  async clockIn(attendantId: string, siteId: string, code: string, requestId: RequestId): Promise<AttendantClockInResult> {
    const answer = await this.server
      .write(ATTENDANT_CLOCK_IN_PATH, requestId, { attendantId, siteId, code })
      .catch(rethrowAsAttendantModeRefusal);
    return {
      ok: true,
      requestId: requiredString(answer, 'requestId'),
      attendantId: requiredString(answer, 'attendantId'),
      siteId: requiredString(answer, 'siteId'),
    };
  }

  async listOpenTickets(siteId: string): Promise<readonly TicketSummary[]> {
    const answer = await this.server.read(ATTENDANT_OPEN_TICKETS_PATH, { siteId }).catch(rethrowAsAttendantModeRefusal);
    return requiredList(answer, 'tickets').map((ticket) => readTicketSummary(asRecord(ticket)));
  }

  async listCarsWaitingForCash(siteId: string): Promise<readonly string[]> {
    const answer = await this.server.read(ATTENDANT_CARS_WAITING_FOR_CASH_PATH, { siteId }).catch(rethrowAsAttendantModeRefusal);
    return requiredList(answer, 'cars').map(requiredPlateText);
  }

  async openAssistedTicket(input: AssistedTicketInput): Promise<AssistedTicketResult> {
    const answer = await this.server
      .write(ATTENDANT_ASSISTED_TICKET_PATH, input.requestId, {
        attendantId: input.attendantId,
        siteId: input.siteId,
        driverId: input.driverId,
        plate: input.plate,
      })
      .catch(rethrowAsAttendantModeRefusal);
    return { ok: true, requestId: requiredString(answer, 'requestId'), ...readTicketSummary(answer) };
  }

  async markTicketPaid(ticketId: string, requestId: RequestId): Promise<MarkPaidResult> {
    const answer = await this.server.write(ATTENDANT_TICK_CASH_PATH, requestId, { ticketId }).catch(rethrowAsAttendantModeRefusal);
    return {
      ok: true,
      requestId: requiredString(answer, 'requestId'),
      ticketId: requiredString(answer, 'ticketId'),
      paid: requiredBoolean(answer, 'paid'),
    };
  }
}

function readTicketSummary(record: ServerAnswer): TicketSummary {
  return {
    ticketId: requiredString(record, 'ticketId'),
    driverId: requiredString(record, 'driverId'),
    siteId: requiredString(record, 'siteId'),
    plate: requiredString(record, 'plate'),
    paid: requiredBoolean(record, 'paid'),
    assisted: requiredBoolean(record, 'assisted'),
  };
}

function requiredPlateText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('server answer field cars contains a non-string');
  }
  return value;
}

function rethrowAsAttendantModeRefusal(error: unknown): never {
  if (error instanceof ServerRefusedError) {
    if (isAttendantModeRefusal(error.refusal)) {
      throw new AttendantModeRefusedError(error.refusal);
    }
    if (error.status === UNAUTHORIZED) {
      throw new AttendantModeRefusedError('not clocked in');
    }
  }
  throw error;
}
