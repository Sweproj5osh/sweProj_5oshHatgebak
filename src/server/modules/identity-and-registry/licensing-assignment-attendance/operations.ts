import type { Operation } from '../../../shared/operation-contract';
import type { Authorization } from '../accounts-and-access-control/index';
import { signedSiteCodes, type SiteRegistry } from '../sites-and-areas/index';
import type { LicensingAssignmentAttendance } from './index';
import { assignmentEndpoints } from './assignments-controller';
import { clockIn, clockOut, readOffSiteFlags, recordLocation } from './attendance-controller';
import { SAMPLE } from './controller-support';
import { issueLicence, readLicenceStatus } from './licences-controller';

export interface LicensingOperationsDependencies {
  readonly licensing: LicensingAssignmentAttendance;
  /** The accounts module: its Authorization decides who may read which attendant's licence (P10). */
  readonly accounts: { readonly authorization: Authorization };
  readonly siteRegistry: SiteRegistry;
  /** The secret the site codes are signed with; the clock-in and clock-out sample bodies carry a code signed the same way. */
  readonly siteCodeSecret: string;
}

/**
 * The requests this module answers, for the composition root to register (P4). The entry point writes the one audit
 * entry after a handler succeeds; the handler names the person the change is about, so that person can read the entry,
 * and the district, so its members can (ADR-10). A location reading is a measurement, not an action (P7): it is the one
 * telemetry operation, with no request id, no audit entry and no event; the flag it may raise stays an audited fact.
 */
export function licensingOperations({ licensing, accounts, siteRegistry, siteCodeSecret }: LicensingOperationsDependencies): readonly Operation[] {
  const { assignments } = licensing;
  const districtOfSite = async (siteId: unknown) => (await siteRegistry.locateSite(String(siteId)))?.districtId;
  const districtOfZone = async (zoneId: unknown) => (await siteRegistry.locateZone(String(zoneId)))?.districtId;
  const sampleCodes = signedSiteCodes(siteCodeSecret, SAMPLE.siteId);
  const endpoints = assignmentEndpoints(assignments, districtOfSite, districtOfZone);
  return [
    endpoints.assignAttendant,
    endpoints.changeShift,
    endpoints.releaseAttendant,
    endpoints.assignInspector,
    issueLicence(licensing, districtOfSite),
    readLicenceStatus(licensing, accounts.authorization),
    clockIn(licensing, districtOfSite, sampleCodes.entryCode),
    clockOut(licensing, districtOfSite, sampleCodes.exitCode),
    recordLocation(licensing),
    readOffSiteFlags(licensing),
    endpoints.appointMember,
  ];
}
