/**
 * TicketScanApi adapter: the Driver App talks to the main system only through the HTTP entry point.
 * No ticket rules here: the server's answers are mapped to results, refusals or transport errors.
 */
import { requiredString } from '../server-answer';
import { ServerCall, ServerRefusedError, UNAUTHORIZED, type EntryPointHandle } from '../server-call';
import { DRIVER_CLOSE_TICKET_PATH, DRIVER_OPEN_TICKET_PATH } from './driver-ticket-routes';
import {
  isTicketScanRefusal,
  TicketScanRefusedError,
  type CloseTicketScanInput,
  type ClosedTicketScan,
  type OpenTicketScanInput,
  type OpenedTicketScan,
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

  async openTicket(input: OpenTicketScanInput): Promise<OpenedTicketScan> {
    const answer = await this.server
      .write(DRIVER_OPEN_TICKET_PATH, input.requestId, { siteId: input.siteId, entryCode: input.entryCode })
      .catch(rethrowAsTicketScanRefusal);
    return { ticketId: requiredString(answer, 'ticketId'), siteId: requiredString(answer, 'siteId'), status: 'opened' };
  }

  async closeTicket(input: CloseTicketScanInput): Promise<ClosedTicketScan> {
    const answer = await this.server
      .write(DRIVER_CLOSE_TICKET_PATH, input.requestId, { ticketId: input.ticketId, exitCode: input.exitCode })
      .catch(rethrowAsTicketScanRefusal);
    return { ticketId: requiredString(answer, 'ticketId'), siteId: requiredString(answer, 'siteId'), status: 'closed' };
  }
}

/**
 * The server's "no": a token it did not accept, or a refusal named in the answer's `error` word. The word is read from
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
  throw error;
}
