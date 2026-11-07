import type { HttpResponse } from '../../shared/operation-contract';
import type { EntryPointHandle, ServerRequest } from '../shared-client/server-call';

/** What the entry point's HTTP adapter adds to every request: the client's network address, as the socket reports it. */
export type HandleWithAddress = (request: ServerRequest & { readonly address: string }) => Promise<HttpResponse>;

/**
 * The real server reads the address from the socket; an in-process test has no socket, so this wrapper stamps one on.
 * A public write (sign-in) is refused without it, because the address is the only identity such a write has (ADR-15).
 */
export function fromAddress(handle: HandleWithAddress, address: string): EntryPointHandle {
  return (request) => handle({ ...request, address });
}
