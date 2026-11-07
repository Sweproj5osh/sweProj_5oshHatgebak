/**
 * Test-only support for the apps' data layer (P14): stand-in server operations and fakes that a screen must never
 * import. Every file here is imported by test files only; a unit test under this folder enforces it.
 */
export { answerDroppingHandle, type AnswerDrops } from './answer-dropping-handle';
export { fromAddress, type HandleWithAddress } from './from-address';
export {
  createStandInAccountsState,
  createStandInCarOperations,
  createStandInSignInOperations,
  lastCodeSentTo,
  type StandInAccountsState,
} from './stand-in-driver-auth-operations';
export { InMemoryDriverAuthApi, type InMemoryDriverAuthApiOptions } from './in-memory-driver-auth-api';
export { InMemoryTicketScanApi } from './in-memory-ticket-scan-api';
export { createStandInDriverTicketOperations, createStandInTicketDeskState, type StandInTicketDeskState } from './stand-in-driver-ticket-operations';
export { InMemoryAttendantModeApi } from './in-memory-attendant-mode-api';
export { InMemoryDriverMapApi } from './in-memory-driver-map-api';
export { InMemoryDriverPaymentApi } from './in-memory-driver-payment-api';
