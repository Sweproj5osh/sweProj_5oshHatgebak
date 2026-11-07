import { looksLikeTimestampKey } from '../shared/timestamp-fields';
import { fieldNamesOf, loadComposedOperations, type DeclaredOperation } from './support/composed-operations';
import { defineFitnessFunction } from './support/fitness-result';
import { runWhenInvokedDirectly } from './support/run-as-script';

/** F11: no declared write schema in the composed registry has a field whose name looks like a timestamp (ADR-08, Rule I). */
export const f11WriteSchemasCarryNoTimestamp = defineFitnessFunction(
  'F11',
  'no write schema field is a timestamp',
  async (repositoryRoot) => {
    const writes = (await loadComposedOperations(repositoryRoot)).filter(declaresABody);
    const violations = writes.flatMap((write) =>
      fieldNamesOf(write)
        .filter(looksLikeTimestampKey)
        .map((field) => `${write.name} declares the field "${field}", which looks like a timestamp`),
    );
    const checked = writes.reduce((count, write) => count + fieldNamesOf(write).length, 0);
    return { violations, checked };
  },
);

function declaresABody(operation: DeclaredOperation): boolean {
  return operation.bodySchema !== undefined;
}

runWhenInvokedDirectly(import.meta.url, f11WriteSchemasCarryNoTimestamp);
