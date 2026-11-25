import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import type { RequestHandler } from './handle-request';
import type { HttpMethod } from '../shared/operation-contract';
import type { HttpRequest } from './http';

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export const TLS_CERT_PATH_VARIABLE = 'TLS_CERT_PATH';
export const TLS_KEY_PATH_VARIABLE = 'TLS_KEY_PATH';

/** The server's certificate and private key, as PEM text. */
export interface TlsCertificate {
  readonly cert: string;
  readonly key: string;
}

/**
 * The certificate named by the environment (ADR-22). Plain HTTP never serves the API, so a missing or unreadable
 * certificate stops start-up with the variable's name in the message.
 */
export async function readTlsCertificate(environment: NodeJS.ProcessEnv): Promise<TlsCertificate> {
  const [cert, key] = await Promise.all([readPem(environment, TLS_CERT_PATH_VARIABLE), readPem(environment, TLS_KEY_PATH_VARIABLE)]);
  return { cert, key };
}

async function readPem(environment: NodeJS.ProcessEnv, variable: string): Promise<string> {
  const file = environment[variable];
  if (file === undefined || file === '') {
    throw new Error(`${variable} must name a PEM file: the server answers over HTTPS only and never over plain HTTP`);
  }
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`${variable} names ${file}, which cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The humble adapter between Node's https module and the pipeline: parse, hand over, serialise. No rules here. */
export function createHttpsServer(handle: RequestHandler, certificate: TlsCertificate): Server {
  return createServer({ cert: certificate.cert, key: certificate.key }, async (incoming, outgoing) => {
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
  const url = new URL(incoming.url ?? '/', 'https://localhost');
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
