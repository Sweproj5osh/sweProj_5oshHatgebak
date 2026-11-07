import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { RequestHandler } from './handle-request';
import type { HttpMethod } from '../shared/operation-contract';
import type { HttpRequest } from './http';

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE'];

/** The humble adapter between Node's http module and the pipeline: parse, hand over, serialise. No rules here. */
export function createHttpServer(handle: RequestHandler): Server {
  return createServer(async (incoming, outgoing) => {
    try {
      const request = await toHttpRequest(incoming);
      const response = await handle(request);
      writeJson(outgoing, response.status, response.body);
    } catch (error) {
      writeJson(outgoing, 400, { error: error instanceof Error ? error.message : 'unreadable request' });
    }
  });
}

async function toHttpRequest(incoming: IncomingMessage): Promise<HttpRequest> {
  const url = new URL(incoming.url ?? '/', 'http://localhost');
  const rawBody = await readBody(incoming);
  return {
    method: parseMethod(incoming.method),
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: lowerCaseHeaders(incoming),
    address: clientAddressOf(incoming),
    ...(rawBody === '' ? {} : { body: JSON.parse(rawBody) as unknown }),
  };
}

function parseMethod(method: string | undefined): HttpMethod {
  if (method !== undefined && (METHODS as readonly string[]).includes(method)) {
    return method as HttpMethod;
  }
  throw new Error(`unsupported method ${method ?? '(none)'}`);
}

function clientAddressOf(incoming: IncomingMessage): string {
  const address = incoming.socket.remoteAddress;
  if (address === undefined) {
    throw new Error('the connection closed before its address could be read');
  }
  return address;
}

function lowerCaseHeaders(incoming: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') {
      headers[name.toLowerCase()] = value;
    }
  }
  return headers;
}

function readBody(incoming: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    incoming.on('error', reject);
  });
}

function writeJson(outgoing: ServerResponse, status: number, body: unknown): void {
  if (body === undefined) {
    outgoing.writeHead(status);
    outgoing.end();
    return;
  }
  outgoing.writeHead(status, { 'content-type': 'application/json' });
  outgoing.end(JSON.stringify(body));
}
