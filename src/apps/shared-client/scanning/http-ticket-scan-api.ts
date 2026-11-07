/**
 * TicketScanApi adapter: the Driver App talks to the main system only through the HTTP entry point.
 * No ticket rules here: the server's `{ ticket }` answers are read as they are; refusals are the server's words.
 */
import { optionalNumber, optionalString, optionalStringList, requiredBoolean, requiredRecord, requiredString, requiredWord, type ServerAnswer } from '../server-answer';
import { asTransportFailureIfServerFailed, ServerCall, ServerRefusedError, UNAUTHORIZED, type EntryPointHandle } from '../server-call';
import { DRIVER_CLOSE_TICKET_PATH, DRIVER_OPEN_TICKET_PATH } from './driver-ticket-routes';
import {
  isTicketScanRefusal,
  PAYMENT_STATUSES,
  TICKET_STATES,
  TicketScanRefusedError,
  type CloseTicketScanInput,
  type OpenTicketScanInput,
  type ScannedTicket,
  type TicketScanApi,
} from './ticket-scan-api';

export interface HttpTicketScanApiOptions {
  readonly handle: EntryPointHandle;
  /** The signed-in driver's token, as the sign-in client holds it. */
  readonly token: () => string | undefined;
}

export class HttpTicketScanApi implements TicketScanApi {
  private readonly server: ServerCall;

  constructor(options: HttpTicketScanApiOptions) {
    this.server = new ServerCall({ handle: options.handle, token: options.token });
  }

  async openTicket(input: OpenTicketScanInput): Promise<ScannedTicket> {
    const body = { siteId: input.siteId, carRef: input.carRef, entryCode: input.entryCode };
    const answer = await this.server.write(DRIVER_OPEN_TICKET_PATH, input.requestId, body).catch(rethrowAsTicketScanRefusal);
    return readTicket(requiredRecord(answer, 'ticket'));
  }

  async closeTicket(input: CloseTicketScanInput): Promise<ScannedTicket> {
    const body = { ticketId: input.ticketId, exitCode: input.exitCode };
    const answer = await this.server.write(DRIVER_CLOSE_TICKET_PATH, input.requestId, body).catch(rethrowAsTicketScanRefusal);
    return readTicket(requiredRecord(answer, 'ticket'));
  }
}

function readTicket(ticket: ServerAnswer): ScannedTicket {
  const closedAt = optionalString(ticket, 'closedAt');
  const fee = optionalNumber(ticket, 'fee');
  const feeWarnings = optionalStringList(ticket, 'feeWarnings');
  return {
    ticketId: requiredString(ticket, 'ticketId'),
    siteId: requiredString(ticket, 'siteId'),
    driverRef: requiredString(ticket, 'driverRef'),
    carRef: requiredString(ticket, 'carRef'),
    state: requiredWord(ticket, 'state', TICKET_STATES),
    paymentStatus: requiredWord(ticket, 'paymentStatus', PAYMENT_STATUSES),
    openedAt: requiredString(ticket, 'openedAt'),
    ...(closedAt === undefined ? {} : { closedAt }),
    ...(fee === undefined ? {} : { fee }),
    ...(feeWarnings === undefined ? {} : { feeWarnings }),
    assisted: requiredBoolean(ticket, 'assisted'),
  };
}

/**
 * The server's "no": a refusal named in the answer's `error` word, or a token it did not accept. The word is read from
 * the answer, not from the status code, because the status codes are the owner's to choose. Any other word is a fault,
 * not a refusal, and is not turned into one.
 */
function rethrowAsTicketScanRefusal(error: unknown): never {
  if (error instanceof ServerRefusedError) {
    if (isTicketScanRefusal(error.refusal)) {
      throw new TicketScanRefusedError(error.refusal);
    }
    if (error.status === UNAUTHORIZED) {
      throw new TicketScanRefusedError('not signed in');
    }
  }
  return asTransportFailureIfServerFailed(error);
}
