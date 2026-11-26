import { request } from 'node:https';

export interface HttpsAnswer {
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * Test-only: the slice of `fetch` the adapter tests use, over HTTPS trusting exactly the given certificate (never with
 * verification switched off). Node's own `fetch` cannot be handed a certificate authority per call.
 */
export function httpsFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }, trusted: string): Promise<HttpsAnswer> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { method: init.method ?? 'GET', headers: init.headers ?? {}, ca: trusted }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: incoming.statusCode ?? 0, json: async () => JSON.parse(text) as unknown, text: async () => text });
      });
      incoming.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end(init.body);
  });
}
