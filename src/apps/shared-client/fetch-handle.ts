/**
 * The entry point as the real app reaches it (ADR-22): one HTTPS request per call, through `fetch`. It holds no
 * business rule (Rule A): it carries the method, the path, the query, the headers and the JSON body, and hands back the
 * status and the JSON answer. A request that gets no answer throws, and ServerCall reports it as a transport failure
 * the caller may retry with the same request id.
 */
import type { EntryPointHandle } from './server-call';

/** The slice of `fetch` this handle uses, so a test can trust a throwaway certificate. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ readonly status: number; text(): Promise<string> }>;

export function fetchHandle(baseUrl: string, send: FetchLike = (url, init) => fetch(url, init)): EntryPointHandle {
  if (!baseUrl.startsWith('https://')) {
    throw new Error(`the server address ${baseUrl} must start with https://: the server never answers plain HTTP`);
  }
  const base = baseUrl.replace(/\/+$/, '');
  return async (request) => {
    const query = Object.entries(request.query)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    const headers = request.body === undefined ? { ...request.headers } : { ...request.headers, 'content-type': 'application/json' };
    const answer = await send(`${base}${request.path}${query === '' ? '' : `?${query}`}`, {
      method: request.method,
      headers,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });
    const text = await answer.text();
    return { status: answer.status, body: text === '' ? undefined : (JSON.parse(text) as unknown) };
  };
}
