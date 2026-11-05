export interface DriverSignInRequest {
  readonly requestId: string;
  readonly phone: string;
  readonly code: string;
}

export type DriverSignInSuccess = {
  readonly ok: true;
  readonly requestId: string;
  readonly driverId: string;
  readonly phone: string;
  readonly sessionId: string;
};

export type DriverSignInFailure = {
  readonly ok: false;
  readonly requestId: string;
  readonly error: 'wrong code';
};

export type DriverSignInResult = DriverSignInSuccess | DriverSignInFailure;

export interface SaveCarRequest {
  readonly requestId: string;
  readonly driverId: string;
  readonly plate: string;
}

export type SaveCarSuccess = {
  readonly ok: true;
  readonly requestId: string;
  readonly driverId: string;
  readonly plate: string;
  readonly cars: string[];
};

export type SaveCarFailure = {
  readonly ok: false;
  readonly requestId: string;
  readonly error: 'driver not signed in' | 'duplicate plate';
};

export type SaveCarResult = SaveCarSuccess | SaveCarFailure;

export interface DriverSignInState {
  readonly sessions: Map<string, string>;
  readonly byPhone: Map<string, string>;
  readonly codes: Map<string, string>;
  readonly cars: Map<string, string[]>;
  readonly signInResponses: Map<string, DriverSignInResult>;
  readonly carResponses: Map<string, SaveCarResult>;
  nextDriverNumber: number;
}

export function createDriverSignInState(seedCodes: Map<string, string> = new Map()): DriverSignInState {
  return {
    sessions: new Map(),
    byPhone: new Map(),
    codes: new Map(seedCodes),
    cars: new Map(),
    signInResponses: new Map(),
    carResponses: new Map(),
    nextDriverNumber: 1,
  };
}

export function createDriverAppState(): DriverSignInState {
  return createDriverSignInState();
}

export function processDriverSignIn(
  state: DriverSignInState,
  request: DriverSignInRequest,
): DriverSignInResult {
  const known = state.signInResponses.get(request.requestId);
  if (known) {
    return known;
  }

  const expectedCode = state.codes.get(request.phone) ?? `driver-code-${request.phone}`;
  if (request.code !== expectedCode) {
    const failure: DriverSignInFailure = {
      ok: false,
      requestId: request.requestId,
      error: 'wrong code',
    };
    state.signInResponses.set(request.requestId, failure);
    return failure;
  }

  let driverId = state.byPhone.get(request.phone);
  if (driverId === undefined) {
    driverId = `driver-${request.phone}`;
    state.byPhone.set(request.phone, driverId);
  }

  const sessionId = `session-${driverId}`;
  state.sessions.set(driverId, sessionId);

  const success: DriverSignInSuccess = {
    ok: true,
    requestId: request.requestId,
    driverId,
    phone: request.phone,
    sessionId,
  };

  state.signInResponses.set(request.requestId, success);
  return success;
}

export function signInDriver(state: DriverSignInState, request: DriverSignInRequest): DriverSignInResult {
  return processDriverSignIn(state, request);
}

export function addDriverCar(state: DriverSignInState, request: SaveCarRequest): SaveCarResult {
  const known = state.carResponses.get(request.requestId);
  if (known) {
    return known;
  }

  if (!state.sessions.has(request.driverId)) {
    const failure: SaveCarFailure = {
      ok: false,
      requestId: request.requestId,
      error: 'driver not signed in',
    };
    state.carResponses.set(request.requestId, failure);
    return failure;
  }

  const existing = state.cars.get(request.driverId) ?? [];
  if (existing.includes(request.plate)) {
    const failure: SaveCarFailure = {
      ok: false,
      requestId: request.requestId,
      error: 'duplicate plate',
    };
    state.carResponses.set(request.requestId, failure);
    return failure;
  }

  const cars = [...existing, request.plate];
  state.cars.set(request.driverId, cars);

  const success: SaveCarSuccess = {
    ok: true,
    requestId: request.requestId,
    driverId: request.driverId,
    plate: request.plate,
    cars,
  };

  state.carResponses.set(request.requestId, success);
  return success;
}

export function saveDriverCar(state: DriverSignInState, request: SaveCarRequest): SaveCarResult {
  return addDriverCar(state, request);
}

export function registerDriverCar(
  state: DriverSignInState,
  driverId: string,
  plate: string,
  requestId = `car-${state.nextDriverNumber++}`,
): SaveCarResult {
  return addDriverCar(state, { requestId, driverId, plate });
}

export function getDriverCars(state: DriverSignInState, driverId: string): string[] {
  return [...(state.cars.get(driverId) ?? [])];
}

export function listDriverCars(state: DriverSignInState, driverId: string): string[] {
  return getDriverCars(state, driverId);
}
