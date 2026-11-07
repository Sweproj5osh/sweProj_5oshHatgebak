import { describe, expect, it } from 'vitest';
import { refuse, respond, type HttpResponse } from '../../shared/operation-contract';
import { REQUEST_ID_HEADER } from '../../shared/request-id';
import { asTransportFailureIfServerFailed, ServerCall, ServerRefusedError, ServerTransportError, type ServerRequest } from './server-call';

function recordingServer(answer: HttpResponse) {
  const requests: ServerRequest[] = [];
  const call = new ServerCall({
    handle: async (request) => {
      requests.push(request);
      return answer;
    },
    token: () => 'token-of-the-signed-in-person',
  });
  return { call, requests };
}

describe('the one HTTP call of the data layer', () => {
  it('sends a write as POST with the token and the request id, and returns the answer as a record', async () => {
    const { call, requests } = recordingServer(respond(201, { ticket: { ticketId: 'ticket-1' } }));

    const answer = await call.write('/tickets/open', 'request-0001', { siteId: 'site-1' });

    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/tickets/open',
        query: {},
        headers: { authorization: 'Bearer token-of-the-signed-in-person', [REQUEST_ID_HEADER]: 'request-0001' },
        body: { siteId: 'site-1' },
      },
    ]);
    expect(answer).toEqual({ ticket: { ticketId: 'ticket-1' } });
  });

  it('sends a plain read as GET with the query and no request id, and a logged read with the request id', async () => {
    const { call, requests } = recordingServer(respond(200, { cars: [] }));

    await call.read('/cars', {});
    await call.loggedRead('/tickets/receipt', { ticketId: 'ticket-1' }, 'request-0002');

    expect(requests.map((request) => [request.method, request.path, request.query, request.headers[REQUEST_ID_HEADER]])).toEqual([
      ['GET', '/cars', {}, undefined],
      ['GET', '/tickets/receipt', { ticketId: 'ticket-1' }, 'request-0002'],
    ]);
  });

  it('sends no authorization header before sign-in', async () => {
    const requests: ServerRequest[] = [];
    const call = new ServerCall({
      handle: async (request) => {
        requests.push(request);
        return respond(202, {});
      },
    });

    await call.write('/sign-in/code', 'request-0003', { phone: '01012345678' });

    expect(requests[0]?.headers).toEqual({ [REQUEST_ID_HEADER]: 'request-0003' });
  });

  it('turns a 4xx answer into a refusal carrying the status and the server word', async () => {
    const { call } = recordingServer(refuse(409, 'car already parked'));

    const outcome = call.write('/tickets/open', 'request-0004', {});

    await expect(outcome).rejects.toBeInstanceOf(ServerRefusedError);
    await expect(outcome).rejects.toMatchObject({ status: 409, refusal: 'car already parked' });
  });

  it('turns a dropped connection into a transport failure, so the caller retries with the same id', async () => {
    const dropped = new ServerCall({
      handle: async () => {
        throw new Error('socket hang up');
      },
    });

    const outcome = dropped.write('/tickets/open', 'request-0005', {});

    await expect(outcome).rejects.toBeInstanceOf(ServerTransportError);
    await expect(outcome).rejects.toMatchObject({ message: 'socket hang up' });
  });

  it('carries a 5xx answer as a refusal with its word, and the adapter decides: a known word is shown, an unknown one is retried', async () => {
    const { call } = recordingServer(respond(500, { error: 'internal error', correlationId: 'c-1' }));

    const outcome = call.write('/tickets/open', 'request-0006', {}).catch(asTransportFailureIfServerFailed);

    await expect(outcome).rejects.toBeInstanceOf(ServerTransportError);
    await expect(outcome).rejects.toMatchObject({ message: 'server error 500: internal error' });
    await expect(Promise.reject(new ServerRefusedError(409, 'car already parked')).catch(asTransportFailureIfServerFailed)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('names a refusal without a word by its status', async () => {
    const { call } = recordingServer(respond(418, 'not even json'));

    await expect(call.read('/anything', {})).rejects.toMatchObject({ refusal: 'request refused with status 418' });
  });
});
