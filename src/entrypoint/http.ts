/** Plain data crossing the boundary between Node's http module and the request pipeline. No framework types. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly path: string;
  /** The URL's query string, parsed. Never trusted for identity or scope: those come from the token. */
  readonly query: Readonly<Record<string, string>>;
  /** Header names lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
  /** The parsed JSON body, or undefined when the request carried none. */
  readonly body?: unknown;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export function respond(status: number, body: unknown): HttpResponse {
  return { status, body };
}

export function refuse(status: number, message: string, details?: unknown): HttpResponse {
  return respond(status, details === undefined ? { error: message } : { error: message, details });
}
