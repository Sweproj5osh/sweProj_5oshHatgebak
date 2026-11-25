# REST route catalogue

Every endpoint the server answers, in registration order (ADR-22). Paths are relative to the server's HTTPS address;
`:name` is a path parameter. Controllers live in `src/server/modules/` (a `…/` repeats the folder of the row above).
Client constants live in `src/apps/shared-client/*/*-routes.ts`. **Status codes are exactly the ones each operation
answered before the restructure**; only the URLs changed (the left column shows each old one).

How a path parameter reaches the operation: the value joins the query of a read and the body of every other kind,
before the server-clock rule, the schema, the body hash and the audit entry see the input. The body or query may repeat
the field with the same value (the shared client and the tests do); another value is refused with 400 ("the request
repeats a field the path names, with another value"). A known path with the wrong method answers 404 after the token
check, as an unknown path does.

| Operation (kind) | Endpoint | Before | Controller | Client constant |
|---|---|---|---|---|
| requestSignInCode (public) | `POST /sign-in-codes` | `POST /sign-in/code` | `identity-and-registry/accounts-and-access-control/sign-in-controller.ts` | DRIVER_REQUEST_CODE_PATH |
| signIn (public) | `POST /sessions` | `POST /sign-in` | `identity-and-registry/accounts-and-access-control/sign-in-controller.ts` | DRIVER_SIGN_IN_PATH |
| signIn (public) | `POST /committee-sessions` | `POST /sign-in/committee` | `identity-and-registry/accounts-and-access-control/sign-in-controller.ts` | — |
| personalData.createPerson (write) | `POST /people` | unchanged | `identity-and-registry/accounts-and-access-control/people-controller.ts` | — |
| personalData.addCar (write) | `POST /cars` | unchanged | `identity-and-registry/accounts-and-access-control/cars-controller.ts` | DRIVER_CARS_PATH |
| signIn.setCommitteePassword (write) | `PUT /people/:personId/committee-password` | `POST /committee/password` | `…/people-controller.ts` | — |
| personalData.erase (write) | `POST /erasures` | `POST /people/erasure` | `…/people-controller.ts` | — |
| personalData.ownCars (read, own) | `GET /cars` | unchanged | `…/cars-controller.ts` | DRIVER_CARS_PATH |
| personalData.lookUpPlate (read, staff-scoped, logged) | `GET /cars/:carRef/plate` | `GET /plates/look-up` | `…/cars-controller.ts` | — |
| audit.readByScope (read, own) | `GET /audit-log` | unchanged | `foundation/audit-log/audit-log-controller.ts` | — |
| audit.verifyChain (read, own) | `GET /audit-log/verification` | unchanged | `…/audit-log-controller.ts` | — |
| assignments.assignAttendant (write) | `POST /attendant-assignments` | `POST /assignments/attendants` | `identity-and-registry/licensing-assignment-attendance/assignments-controller.ts` | — |
| assignments.changeShift (write) | `PATCH /attendant-assignments/:attendantId` | `POST /assignments/attendants/shift` | `…/assignments-controller.ts` | — |
| assignments.releaseAttendant (write) | `POST /attendant-releases` | `POST /assignments/attendants/release` | `…/assignments-controller.ts` | — |
| assignments.assignInspector (write) | `PUT /inspector-assignments/:inspectorId` | `POST /assignments/inspectors` | `…/assignments-controller.ts` | — |
| licences.issue (write) | `POST /licences` | unchanged | `identity-and-registry/licensing-assignment-attendance/licences-controller.ts` | — |
| licences.status (read, staff-scoped) | `GET /attendants/:attendantId/licence` | `GET /licences/status` | `…/licences-controller.ts` | — |
| attendance.clockIn (write) | `POST /attendances` | `POST /attendance/clock-in` | `identity-and-registry/licensing-assignment-attendance/attendance-controller.ts` | ATTENDANT_CLOCK_IN_PATH |
| attendance.clockOut (write) | `PATCH /attendances/current` | `POST /attendance/clock-out` | `…/attendance-controller.ts` | — |
| attendance.recordLocation (telemetry) | `POST /location-readings` | `POST /attendance/location-readings` | `…/attendance-controller.ts` | — |
| attendance.offSiteFlags (read, staff-scoped) | `GET /off-site-flags` | `GET /attendance/off-site-flags` | `…/attendance-controller.ts` | — |
| assignments.appointMember (write) | `PUT /member-appointments/:memberId` | `POST /assignments/members` | `…/assignments-controller.ts` | — |
| sites.createDistrict (write) | `POST /districts` | unchanged | `identity-and-registry/sites-and-areas/districts-controller.ts` | — |
| sites.relabelDistrict (write) | `PATCH /districts/:districtId` | `POST /districts/label` | `…/districts-controller.ts` | — |
| sites.createZone (write) | `POST /zones` | unchanged | `identity-and-registry/sites-and-areas/zones-controller.ts` | — |
| sites.relabelZone (write) | `PATCH /zones/:zoneId` | `POST /zones/label` | `…/zones-controller.ts` | — |
| sites.createSite (write) | `POST /sites` | unchanged | `identity-and-registry/sites-and-areas/sites-controller.ts` | — |
| sites.replaceOutline (write) | `PUT /sites/:siteId/outline` | `POST /sites/outline` | `…/sites-controller.ts` | — |
| sites.changeCapacity (write) | `POST /sites/:siteId/capacity-changes` | `POST /sites/capacity` | `…/sites-controller.ts` | — |
| sites.setWeeklyHours (write) | `PUT /sites/:siteId/opening-hours` | `POST /sites/hours` | `…/sites-controller.ts` | — |
| sites.declareSpecialEvent (write) | `POST /sites/:siteId/special-events` | `POST /sites/special-events` | `…/sites-controller.ts` | — |
| sites.details (read, open) | `GET /sites/:siteId` | `GET /sites/details` | `…/sites-controller.ts` | — |
| sites.statusNow (read, open) | `GET /sites/:siteId/status` | `GET /sites/status` | `…/sites-controller.ts` | — |
| sites.nearby (read, open) | `GET /sites` | `GET /sites/nearby` | `…/sites-controller.ts` | DRIVER_MAP_NEARBY_PATH |
| sites.capacityHistory (read, staff-scoped) | `GET /sites/:siteId/capacity-changes` | `GET /sites/capacity-history` | `…/sites-controller.ts` | — |
| ticketing.openTicket (write) | `POST /tickets` | `POST /tickets/open` | `parking-and-prices/ticketing/tickets-controller.ts` | DRIVER_OPEN_TICKET_PATH |
| ticketing.closeTicket (write) | `POST /tickets/:ticketId/closure` | `POST /tickets/close` | `…/tickets-controller.ts` | DRIVER_CLOSE_TICKET_PATH |
| ticketing.openAssistedTicket (write) | `POST /assisted-tickets` | `POST /tickets/open-assisted` | `parking-and-prices/ticketing/assisted-tickets-controller.ts` | — |
| ticketing.closeAssistedTicket (write) | `POST /assisted-tickets/:ticketId/closure` | `POST /tickets/close-assisted` | `…/assisted-tickets-controller.ts` | — |
| ticketing.ticketHistory (read, own) | `GET /tickets` | unchanged | `…/tickets-controller.ts` | — |
| ticketing.ticketStatus (read, own) | `GET /tickets/:ticketId` | `GET /tickets/status` | `…/tickets-controller.ts` | — |
| ticketing.receipt (read, own, logged) | `GET /tickets/:ticketId/receipt` | `GET /tickets/receipt` | `…/tickets-controller.ts` | DRIVER_RECEIPT_PATH |
| ticketing.freeSpaces (read, open) | `GET /sites/:siteId/free-spaces` | `GET /tickets/free-spaces` | `…/tickets-controller.ts` | — |
| example.driver.openTicket (write) | `POST /example/tickets` | unchanged | `server/composition/foundation-operations.ts` | — |
| example.attendant.tickCash (write) | `POST /example/cash-ticks` | unchanged | `server/composition/foundation-operations.ts` | — |
| example.inspector.confirmDeposit (write) | `POST /example/deposit-confirmations` | unchanged | `server/composition/foundation-operations.ts` | — |
| example.member.fileRequest (write) | `POST /example/requests` | unchanged | `server/composition/foundation-operations.ts` | — |
| example.chair.approveRequest (write) | `POST /example/approvals` | unchanged | `server/composition/foundation-operations.ts` | — |
| payments.payInApp (write; registered by its tests only, not yet composed) | `POST /payments` | `POST /payments/app` | `money-and-governance/payments/payments-controller.ts` | DRIVER_PAY_PATH |
