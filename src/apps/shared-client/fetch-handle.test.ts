import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpsServer } from '../../server/http/server';
import { httpsFetch } from '../../server/test-support/https-fetch';
import { testApplication, tokenFor } from '../../server/test-support/test-helpers';
import { throwawayCertificate } from '../../server/test-support/throwaway-certificate';
import { fetchHandle } from './fetch-handle';
import { ServerCall, ServerRefusedError } from './server-call';

const certificate = throwawayCertificate();

describe('the app reaches the entry point over HTTPS (fetchHandle, ADR-22)', () => {
  const server = createHttpsServer(testApplication().handle, certificate);
  let baseUrl = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const call = (token?: string) =>
    new ServerCall({ handle: fetchHandle(baseUrl, (url, init) => httpsFetch(url, init, certificate.cert)), token: () => token });

  it('sends a write with its request id and body, and gets the answer back', async () => {
    const answer = await call(tokenFor('driver')).write('/example/tickets', 'request-fetch-0001', { siteId: 'site-1', entryCode: 'ENTRY-1' });
    expect(answer).toEqual({ operation: 'example.driver.openTicket', requestId: 'request-fetch-0001' });
  });

  it('carries the server\'s refusal as the server said it', async () => {
    await expect(call().read('/audit-log', { districtId: 'district-1' })).rejects.toEqual(new ServerRefusedError(401, 'missing token'));
  });

  it('refuses a server address that is not HTTPS', () => {
    expect(() => fetchHandle('http://127.0.0.1:3000')).toThrow('must start with https://');
  });
});
