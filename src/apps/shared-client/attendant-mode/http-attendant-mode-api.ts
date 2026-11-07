/**
 * AttendantModeApi adapter: the Staff App talks to the main system only through the HTTP entry point.
 * The server's refusal is read from the `error` word; the app never decides whether a code or a site is valid.
 */
import type { RequestId } from '../../../shared/request-id';
import { requiredBoolean, requiredString } from '../server-answer';
import { asTransportFailureIfServerFailed, ServerCall, ServerRefusedError, UNAUTHORIZED, type EntryPointHandle } from '../server-call';
import { AttendantModeRefusedError, isAttendantModeRefusal, type AttendantClockInSuccess, type AttendantModeApi } from './attendant-mode-api';
import { ATTENDANT_CLOCK_IN_PATH } from './attendant-mode-routes';

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

  async clockIn(siteCode: string, requestId: RequestId): Promise<AttendantClockInSuccess> {
    const answer = await this.server.write(ATTENDANT_CLOCK_IN_PATH, requestId, { siteCode }).catch(rethrowAsAttendantModeRefusal);
    if (requiredBoolean(answer, 'clockedIn') !== true) {
      throw new Error('server answered a clock-in with clockedIn false');
    }
    return { siteId: requiredString(answer, 'siteId'), clockedIn: true };
  }
}

function rethrowAsAttendantModeRefusal(error: unknown): never {
  if (error instanceof ServerRefusedError) {
    if (isAttendantModeRefusal(error.refusal)) {
      throw new AttendantModeRefusedError(error.refusal);
    }
    if (error.status === UNAUTHORIZED) {
      throw new AttendantModeRefusedError('not signed in');
    }
  }
  return asTransportFailureIfServerFailed(error);
}
