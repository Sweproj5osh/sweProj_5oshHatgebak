/** A value that is either a success carrying a value or a failure carrying an error; callers must check `ok`. */
export type Result<Value, Error> = Success<Value> | Failure<Error>;

export interface Success<Value> {
  readonly ok: true;
  readonly value: Value;
}

export interface Failure<Error> {
  readonly ok: false;
  readonly error: Error;
}

export function succeed<Value>(value: Value): Success<Value> {
  return { ok: true, value };
}

export function fail<Error>(error: Error): Failure<Error> {
  return { ok: false, error };
}
