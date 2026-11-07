/**
 * The Staff App's view of attendant mode, as far as an owner's operation file declares it: clock-in. The app holds no
 * business rule; it sends the scanned code, shows the site the server bound, and keeps the request id for retrying the
 * same write after a lost answer. Who the attendant is comes from the token on every call, never from a body.
 */
import type { SiteId } from '../../../shared/identifiers';
import type { RequestId } from '../../../shared/request-id';

/** Lino's clock-in answer: the site the signed code named, now bound to the attendant's session. */
export interface AttendantClockInSuccess {
  readonly siteId: SiteId;
  readonly clockedIn: true;
}

/** Lino's `ClockInRefusal` words, and "not signed in" when the server refused the token. */
export type AttendantModeRefusal = 'wrong site' | 'forged code' | 'not assigned' | 'licence not live' | 'not signed in';

export const ATTENDANT_MODE_REFUSALS: readonly AttendantModeRefusal[] = ['wrong site', 'forged code', 'not assigned', 'licence not live', 'not signed in'];

export function isAttendantModeRefusal(candidate: unknown): candidate is AttendantModeRefusal {
  return typeof candidate === 'string' && (ATTENDANT_MODE_REFUSALS as readonly string[]).includes(candidate);
}

/** The server answered and said no. Nothing changed. */
export class AttendantModeRefusedError extends Error {
  readonly refusal: AttendantModeRefusal;

  constructor(refusal: AttendantModeRefusal) {
    super(refusal);
    this.name = 'AttendantModeRefusedError';
    this.refusal = refusal;
  }
}

export interface AttendantModeApi {
  /** The scanned site code is all that travels; the server reads the attendant from the token and the site from the code. */
  clockIn(siteCode: string, requestId: RequestId): Promise<AttendantClockInSuccess>;
}
