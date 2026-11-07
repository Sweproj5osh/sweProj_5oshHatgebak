/**
 * In-memory stand-in for the Staff App clock-in, for client tests that need no server (P14). A code of the form
 * `attendant-<site>` names its site; anything else is forged. The same request id answers the same site.
 */
import type { RequestId } from '../../shared/request-id';
import { AttendantModeRefusedError, type AttendantClockInSuccess, type AttendantModeApi } from '../shared-client/attendant-mode/attendant-mode-api';

const CODE_PREFIX = 'attendant-';

export class InMemoryAttendantModeApi implements AttendantModeApi {
  private readonly clockInAnswers = new Map<RequestId, AttendantClockInSuccess>();

  async clockIn(siteCode: string, requestId: RequestId): Promise<AttendantClockInSuccess> {
    const known = this.clockInAnswers.get(requestId);
    if (known !== undefined) {
      return known;
    }
    if (!siteCode.startsWith(CODE_PREFIX)) {
      throw new AttendantModeRefusedError('forged code');
    }
    const answer: AttendantClockInSuccess = { siteId: siteCode.slice(CODE_PREFIX.length), clockedIn: true };
    this.clockInAnswers.set(requestId, answer);
    return answer;
  }
}
