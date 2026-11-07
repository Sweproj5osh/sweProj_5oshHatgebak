import type { HttpResponse } from '../../shared/operation-contract';
import { ServerTransportError, type EntryPointHandle } from '../shared-client/server-call';

/** How many successful write answers the next calls lose. A test raises `remaining` when airplane mode should strike. */
export interface AnswerDrops {
  remaining: number;
}

const FIRST_REFUSAL_STATUS = 400;

/**
 * Airplane mode after the server applied a write: the pipeline answers, the answer never reaches the phone. The
 * client must then retry with the same request id and receive the stored answer (Rule H). Reads are never dropped.
 */
export function answerDroppingHandle(handle: EntryPointHandle, drops: AnswerDrops): EntryPointHandle {
  return async (request) => {
    const response: HttpResponse = await handle(request);
    if (request.method !== 'GET' && response.status < FIRST_REFUSAL_STATUS && drops.remaining > 0) {
      drops.remaining -= 1;
      throw new ServerTransportError();
    }
    return response;
  };
}
