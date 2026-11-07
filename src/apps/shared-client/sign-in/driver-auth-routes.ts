/**
 * HTTP routes the Driver App uses for sign-in and cars.
 *
 * Sign-in is the two public operations of P3 (ADR-15): `requestSignInCode` at POST /sign-in/code (body: phone) and
 * `signIn` at POST /sign-in (body: phone, code), which Lino registers in accounts-and-access-control. The app calls
 * them through the entry point like every other request; nothing answers sign-in before the pipeline.
 *
 * Cars: GET /cars is Lino's `personalData.ownCars` and answers `{ cars: [{ carRef, plate }] }`. POST /cars with a
 * plate is this app's proposal for `personalData.addCar`, which Lino has not registered yet (it waits on the
 * redaction rule of P2); the pull request lists it under "Needs Lino".
 */
export const DRIVER_REQUEST_CODE_PATH = '/sign-in/code';
export const DRIVER_SIGN_IN_PATH = '/sign-in';
export const DRIVER_CARS_PATH = '/cars';

export const REQUEST_SIGN_IN_CODE_OPERATION = 'requestSignInCode';
export const SIGN_IN_OPERATION = 'signIn';
export const DRIVER_OWN_CARS_OPERATION = 'personalData.ownCars';
export const DRIVER_ADD_CAR_OPERATION = 'personalData.addCar';
