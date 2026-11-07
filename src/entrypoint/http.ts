import type { HttpMethod } from '../shared/operation-contract';

/** What Node's http module hands the pipeline, as plain data. The response half of the contract is in src/shared. */
export interface HttpRequest {
  readonly method: HttpMethod;
  readonly path: string;
  /** The URL's query string, parsed. Never trusted for identity or scope: those come from the token. */
  readonly query: Readonly<Record<string, string>>;
  /** Header names lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
  /** The client's network address, as the socket reports it: the only identity a public operation has (ADR-15). */
  readonly address: string;
  /** The parsed JSON body, or undefined when the request carried none. */
  readonly body?: unknown;
}
