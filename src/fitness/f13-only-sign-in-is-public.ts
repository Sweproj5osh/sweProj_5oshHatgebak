import { loadComposedOperations } from './support/composed-operations';
import { defineFitnessFunction } from './support/fitness-result';
import { runWhenInvokedDirectly } from './support/run-as-script';

/** The only two operations that may run without a token (P3, ADR-15). Both belong to accounts-and-access-control. */
export const PUBLIC_OPERATION_NAMES: readonly string[] = ['requestSignInCode', 'signIn'];

/** F13: the set of public operation names in the composed registry is a subset of the two sign-in operations. */
export const f13OnlySignInIsPublic = defineFitnessFunction(
  'F13',
  'only requestSignInCode and signIn are public operations',
  async (repositoryRoot) => {
    const operations = await loadComposedOperations(repositoryRoot);
    const violations = operations
      .filter((operation) => operation.kind === 'public' && !PUBLIC_OPERATION_NAMES.includes(operation.name))
      .map((operation) => `${operation.name} is a public operation, but only ${PUBLIC_OPERATION_NAMES.join(' and ')} may be public`);
    return { violations, checked: operations.length };
  },
);

runWhenInvokedDirectly(import.meta.url, f13OnlySignInIsPublic);
