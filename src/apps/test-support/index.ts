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
