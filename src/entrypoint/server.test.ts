import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeInMemoryApplication } from './composition';
import { createHttpServer } from './server';
import { TEST_TOKEN_SECRET, tokenFor } from './test-helpers';

describe('http server adapter', () => {
  const server = createHttpServer(composeInMemoryApplication({ tokenSecret: TEST_TOKEN_SECRET }).handle);
  let baseUrl = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('parses a JSON write, runs the pipeline and answers JSON', async () => {
    const response = await fetch(`${baseUrl}/example/tickets`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenFor('driver')}`,
        'x-request-id': 'request-0001',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ siteId: 'site-1', entryCode: 'ENTRY-1' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ operation: 'example.driver.openTicket', requestId: 'request-0001' });
  });

  it('passes the query string to reads', async () => {
    const response = await fetch(`${baseUrl}/audit-log?districtId=district-1`, {
      headers: { authorization: `Bearer ${tokenFor('member')}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entries: [] });
  });

  it('answers 404 with the path alone deciding the route', async () => {
    const response = await fetch(`${baseUrl}/nowhere?x=1`, { headers: { authorization: `Bearer ${tokenFor('chair')}` } });
    expect(response.status).toBe(404);
  });
});
