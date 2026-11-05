/**
 * HTTP routes the Driver App uses for sign-in and cars.
 * Teammate A's A1/A4 operations should register these paths (or the adapter is updated when the real paths land).
 */
export const DRIVER_REQUEST_CODE_PATH = '/driver/sign-in/request-code';
export const DRIVER_SIGN_IN_PATH = '/driver/sign-in';
export const DRIVER_CARS_PATH = '/driver/cars';

export const DRIVER_REQUEST_CODE_OPERATION = 'driver.requestSignInCode';
export const DRIVER_SIGN_IN_OPERATION = 'driver.signIn';
export const DRIVER_SAVE_CAR_OPERATION = 'driver.saveCar';
export const DRIVER_LIST_CARS_OPERATION = 'driver.listCars';
