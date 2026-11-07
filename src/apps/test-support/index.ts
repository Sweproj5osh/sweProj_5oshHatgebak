/**
 * Test-only support for the apps' data layer (P14): fakes, and stand-in server operations for the routes not on main
 * yet, which a screen must never import. Every file here is imported by test files only; a unit test under this folder
 * enforces it. The sign-in, car and clock-in stand-ins are gone: the real operations serve those routes (P14).
 */
export { answerDroppingHandle, type AnswerDrops } from './answer-dropping-handle';
export { fromAddress, type HandleWithAddress } from './from-address';
export { InMemoryDriverAuthApi, type InMemoryDriverAuthApiOptions } from './in-memory-driver-auth-api';
export { InMemoryTicketScanApi } from './in-memory-ticket-scan-api';
export { InMemoryAttendantModeApi } from './in-memory-attendant-mode-api';
export { createStandInPaymentOperations, createStandInPaymentState, type StandInPaymentState } from './stand-in-payment-operations';
export { platesFor, priceListFor, TEST_PRICE } from './ticketing-ports';
