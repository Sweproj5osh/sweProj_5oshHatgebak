import type { Operation } from '../../../shared/operation-contract';
import type { AccountsAndAccessControl } from './index';
import { addCar, lookUpPlate, readOwnCars } from './cars-controller';
import { createPerson, erasePerson, setCommitteePassword } from './people-controller';
import { requestSignInCode, signIn, signInWithSecondStep } from './sign-in-controller';

export interface AccountsOperationsDependencies {
  readonly accounts: AccountsAndAccessControl;
  /** The secret the module keys code hashes with; the sign-in sample of the F5 harness seeds a code hashed the same way. */
  readonly signInCodeSecret: string;
}

/**
 * The requests this module answers, for the composition root to register (P4). The entry point checks the token, the
 * role, the scope, the request id and the body before a handler runs, and writes the one redacted audit entry after it
 * succeeds (ADR-14); a handler only names the subject and returns the references that stand in for personal fields.
 * Sign-in is the one door without a token: the two public operations of ADR-15, at the paths the apps call.
 */
export function accountsOperations({ accounts, signInCodeSecret }: AccountsOperationsDependencies): readonly Operation[] {
  return [
    requestSignInCode(accounts),
    signIn(accounts, signInCodeSecret),
    signInWithSecondStep(accounts, signInCodeSecret),
    createPerson(accounts),
    addCar(accounts),
    setCommitteePassword(accounts),
    erasePerson(accounts),
    readOwnCars(accounts),
    lookUpPlate(accounts),
  ];
}
