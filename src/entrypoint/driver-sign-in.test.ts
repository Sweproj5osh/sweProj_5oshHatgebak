import { describe, expect, it } from 'vitest';
import { addDriverCar, createDriverSignInState, processDriverSignIn } from './driver-sign-in';

describe('D1 driver app sign-in and cars', () => {
  it('signs in with the right phone and code', () => {
    const state = createDriverSignInState();

    const result = processDriverSignIn(state, {
      requestId: 'sign-in-1',
      phone: '01000000000',
      code: 'driver-code-01000000000',
    });

    expect(result.ok).toBe(true);
    expect(result.driverId).toBe('driver-01000000000');
    expect(result.phone).toBe('01000000000');
    expect(state.sessions.has('driver-01000000000')).toBe(true);
  });

  it('refuses a wrong code', () => {
    const state = createDriverSignInState();

    const result = processDriverSignIn(state, {
      requestId: 'sign-in-2',
      phone: '01000000001',
      code: 'wrong-code',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('wrong code');
  });

  it('keeps the request id idempotent and stores a saved car under the driver', () => {
    const state = createDriverSignInState();

    const first = processDriverSignIn(state, {
      requestId: 'sign-in-3',
      phone: '01000000002',
      code: 'driver-code-01000000002',
    });

    const duplicate = processDriverSignIn(state, {
      requestId: 'sign-in-3',
      phone: '01000000002',
      code: 'driver-code-01000000002',
    });

    expect(first).toEqual(duplicate);

    const saveResult = addDriverCar(state, {
      requestId: 'car-1',
      driverId: first.driverId,
      plate: 'ABC-123',
    });

    expect(saveResult.ok).toBe(true);
    expect(state.cars.get(first.driverId)).toEqual(['ABC-123']);
  });
});
