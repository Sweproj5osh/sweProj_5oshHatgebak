/**
 * The one HTTP call of the apps' data layer (P12). Every adapter sends through it: the token of the signed-in person,
 * the request id of a write or a logged read (Rule H, P9), and the plain request the entry point's own HTTP adapter
 * hands the pipeline, so a test can call the pipeline in-process. It holds no business rule (Rule A): a status of
 * 400 or above is the server's "no", carried as the word in the answer's `error`, and the adapter that knows the
 * operation decides which words the screen shows; no answer at all is a transport failure the caller may retry with
 * the same request id.
 */
import type { HttpMethod, HttpResponse } from '../../shared/operation-contract';
import { REQUEST_ID_HEADER, type RequestId } from '../../shared/request-id';
import { asRecord, type ServerAnswer } from './server-answer';

/** What the app sends: the same plain data the entry point's HTTP adapter builds from a Node request. */
export interface ServerRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  /** Header names lower-cased, as the entry point expects them. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/** The entry point as the app reaches it: in-process in tests, over the network in the real app. */
export type EntryPointHandle = (request: ServerRequest) => Promise<HttpResponse>;

/** The connection dropped or the server failed before an answer arrived: a write may or may not have happened. */
export class ServerTransportError extends Error {
  constructor(message = 'connection lost before the answer arrived') {
    super(message);
    this.name = 'ServerTransportError';
  }
}

/** The server answered and said no, with the word it chose. Nothing was changed on the server. */
export class ServerRefusedError extends Error {
  readonly status: number;
  readonly refusal: string;

  constructor(status: number, refusal: string) {
    super(refusal);
    this.name = 'ServerRefusedError';
    this.status = status;
    this.refusal = refusal;
  }
}

export const UNAUTHORIZED = 401;
const FIRST_REFUSAL_STATUS = 400;
const FIRST_SERVER_FAILURE_STATUS = 500;

export interface ServerCallOptions {
  readonly handle: EntryPointHandle;
  /** The signed-in person's token, or undefined before sign-in. The server checks it; the app only carries it. */
  readonly token?: () => string | undefined;
}

export class ServerCall {
  private readonly handle: EntryPointHandle;
  private readonly token: () => string | undefined;

  constructor(options: ServerCallOptions) {
    this.handle = options.handle;
    this.token = options.token ?? (() => undefined);
  }

  /** A write: always carries the request id, so a retry after a lost answer changes the server once (Rule H). */
  write(path: string, requestId: RequestId, body: Readonly<Record<string, unknown>>): Promise<ServerAnswer> {
    return this.send({ method: 'POST', path, query: {}, headers: this.headers(requestId), body });
  }

  /** A plain read: the answer is the committed rows, nothing is written. */
  read(path: string, query: Readonly<Record<string, string>>): Promise<ServerAnswer> {
    return this.send({ method: 'GET', path, query, headers: this.headers(undefined) });
  }

  /** A logged read (P9): a read that shows personal data carries the request id its one audit entry will name. */
  loggedRead(path: string, query: Readonly<Record<string, string>>, requestId: RequestId): Promise<ServerAnswer> {
    return this.send({ method: 'GET', path, query, headers: this.headers(requestId) });
  }

  private headers(requestId: RequestId | undefined): Record<string, string> {
    const token = this.token();
    return {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(requestId === undefined ? {} : { [REQUEST_ID_HEADER]: requestId }),
    };
  }

  private async send(request: ServerRequest): Promise<ServerAnswer> {
    const response = await this.answerOf(request);
    if (response.status >= FIRST_REFUSAL_STATUS) {
      throw new ServerRefusedError(response.status, refusalWordOf(response));
    }
    return asRecord(response.body);
  }

  private async answerOf(request: ServerRequest): Promise<HttpResponse> {
    try {
      return await this.handle(request);
    } catch (error) {
      throw error instanceof ServerTransportError ? error : new ServerTransportError(describe(error));
    }
  }
}

/**
 * The last step of every adapter's refusal mapping. A word the adapter knows is a refusal the screen shows, whatever
 * the status (Amina's "pay later or pay cash" is a 503). A 5xx the adapter does not know is the server failing: the
 * pipeline rolled the write back and answered "internal error", so the caller retries with the same request id. A 4xx
 * the adapter does not know is a fault in this app or the server, and is not hidden.
 */
export function asTransportFailureIfServerFailed(error: unknown): never {
  if (error instanceof ServerRefusedError && error.status >= FIRST_SERVER_FAILURE_STATUS) {
    throw new ServerTransportError(`server error ${error.status}: ${error.refusal}`);
  }
  throw error;
}

function refusalWordOf(response: HttpResponse): string {
  const error = asRecord(response.body)['error'];
  return typeof error === 'string' ? error : `request refused with status ${response.status}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'connection lost before the answer arrived';
}
