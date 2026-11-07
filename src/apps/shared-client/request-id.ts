/**
 * Request ids for the apps' writes (Rule H, ADR-08). One id is generated per tap and kept until the server answers:
 * a retry after a lost connection carries the same id, so the server changes once and answers the same thing. The id
 * is kept only while the retry is for the same input; a different input is a different request and gets a new id, so
 * a retry can never silently resend an older request in place of the one the person just made.
 */
import { isWellFormedRequestId, type RequestId } from '../../shared/request-id';

/** A fresh id the entry point accepts: a version 4 UUID is 36 letters, digits and hyphens. */
export function randomRequestId(): RequestId {
  const id = globalThis.crypto.randomUUID();
  if (!isWellFormedRequestId(id)) {
    throw new Error(`the generated request id ${id} is not well-formed`);
  }
  return id;
}

interface PendingRequest {
  readonly input: string;
  readonly requestId: RequestId;
}

/** The id of one kind of write (sign-in, scan, payment…) from the tap that starts it to the answer that ends it. */
export class RequestIdKeeper {
  private pending: PendingRequest | undefined;

  constructor(private readonly createRequestId: () => RequestId = randomRequestId) {}

  /** The id of the unanswered request for the same input, or a new id for a new input. */
  idFor(input: string): RequestId {
    if (this.pending?.input !== input) {
      this.pending = { input, requestId: this.createRequestId() };
    }
    return this.pending.requestId;
  }

  /** The server answered (yes or no): the next tap is a new request. */
  settle(): void {
    this.pending = undefined;
  }

  /** The id still waiting for an answer, for the "try again" screen and for tests. */
  pendingId(): RequestId | undefined {
    return this.pending?.requestId;
  }
}
