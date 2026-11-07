import { validateBody, type BodySchema, type ValidBody } from '../shared/body-schema';
import { refuse, type HttpResponse } from '../shared/operation-contract';
import { isWellFormedRequestId, REQUEST_ID_HEADER, type RequestId } from '../shared/request-id';
import { fail, succeed, type Result } from '../shared/result';
import { findTimestampFields } from '../shared/timestamp-fields';
import type { HttpRequest } from './http';
import { bodyHashOf, responseKeyFor, type ResponseStore } from './repeatable-writes/response-store';

export const TIMESTAMPS_ARE_SET_BY_THE_SERVER = 'timestamps are set by the server';
export const REQUEST_ID_REUSED_WITH_DIFFERENT_CONTENT = 'request id reused with different content';

/** A write the pipeline has admitted: well-formed request id, clean body, not a repeat. */
export interface AdmittedWrite {
  readonly requestId: RequestId;
  readonly body: ValidBody;
  readonly responseKey: string;
  readonly bodyHash: string;
}

/**
 * The checks every write passes before any unit of work opens, in order: request id → server clock rule → body schema
 * → repeat check (Rule H, Rule I, P19). The failure side carries the answer to send instead: a refusal, the stored
 * response of an earlier identical write, or 409 when the same id arrives with different content.
 */
export async function admitWrite(
  request: HttpRequest,
  schema: BodySchema,
  responseOwner: string,
  responses: ResponseStore,
): Promise<Result<AdmittedWrite, HttpResponse>> {
  const requestId = admitRequestId(request, 'every write');
  if (!requestId.ok) {
    return requestId;
  }
  const body = admitBody(request, schema);
  if (!body.ok) {
    return body;
  }
  const responseKey = responseKeyFor(responseOwner, requestId.value);
  const bodyHash = bodyHashOf(body.value);
  const earlier = await responses.find(responseKey);
  if (earlier !== undefined) {
    return fail(earlier.bodyHash === bodyHash ? earlier.response : refuse(409, REQUEST_ID_REUSED_WITH_DIFFERENT_CONTENT));
  }
  return succeed({ requestId: requestId.value, body: body.value, responseKey, bodyHash });
}

/** Rule H: the client's request id, well formed, or the refusal naming who needs it ("every write", "a logged read"). */
export function admitRequestId(request: HttpRequest, whoNeedsIt: string): Result<RequestId, HttpResponse> {
  const requestId = request.headers[REQUEST_ID_HEADER];
  if (!isWellFormedRequestId(requestId)) {
    return fail(refuse(400, `${whoNeedsIt} needs a well-formed ${REQUEST_ID_HEADER} header (8 to 128 letters, digits, - or _)`));
  }
  return succeed(requestId);
}

/** The server clock rule (Rule I) and the schema check, shared by every kind that takes a body. */
export function admitBody(request: HttpRequest, schema: BodySchema): Result<ValidBody, HttpResponse> {
  const timestampFields = findTimestampFields(request.body);
  if (timestampFields.length > 0) {
    return fail(refuse(400, TIMESTAMPS_ARE_SET_BY_THE_SERVER, { fields: timestampFields }));
  }
  const body = validateBody(schema, request.body);
  if (!body.ok) {
    return fail(refuse(400, 'body does not match the operation schema', { problems: body.error }));
  }
  return body;
}

/** Only a committed write's response is stored, so a refusal or a rolled-back failure is re-evaluated on retry. */
export async function rememberIfCommitted(admitted: AdmittedWrite, response: HttpResponse, responses: ResponseStore): Promise<HttpResponse> {
  if (response.status < 400) {
    await responses.save(admitted.responseKey, { response, bodyHash: admitted.bodyHash });
  }
  return response;
}
