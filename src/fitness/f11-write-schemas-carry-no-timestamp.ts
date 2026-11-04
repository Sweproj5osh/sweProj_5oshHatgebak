import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { looksLikeTimestampKey } from '../shared/timestamp-fields';
import { defineFitnessFunction } from './support/fitness-result';
import { runWhenInvokedDirectly } from './support/run-as-script';

export const OPERATIONS_MODULE = path.join('src', 'entrypoint', 'operations', 'foundation-operations.ts');
export const OPERATIONS_EXPORT = 'foundationOperations';

interface DeclaredWrite {
  readonly kind: string;
  readonly name: string;
  readonly bodySchema?: { readonly fields: Readonly<Record<string, string>> };
}

/** F11: no declared write schema has a field whose name looks like a timestamp (ADR-08, Rule I). */
export const f11WriteSchemasCarryNoTimestamp = defineFitnessFunction(
  'F11',
  'no write schema field is a timestamp',
  async (repositoryRoot) => {
    const writes = await loadDeclaredWrites(repositoryRoot);
    const violations = writes.flatMap((write) =>
      Object.keys(write.bodySchema?.fields ?? {})
        .filter(looksLikeTimestampKey)
        .map((field) => `${write.name} declares the field "${field}", which looks like a timestamp`),
    );
    const checked = writes.reduce((count, write) => count + Object.keys(write.bodySchema?.fields ?? {}).length, 0);
    return { violations, checked };
  },
);

async function loadDeclaredWrites(repositoryRoot: string): Promise<DeclaredWrite[]> {
  const modulePath = path.join(repositoryRoot, OPERATIONS_MODULE);
  const loaded = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
  const operations = loaded[OPERATIONS_EXPORT];
  if (!Array.isArray(operations)) {
    throw new Error(`${modulePath} must export an array named ${OPERATIONS_EXPORT}`);
  }
  return (operations as DeclaredWrite[]).filter((operation) => operation.kind === 'write');
}

runWhenInvokedDirectly(import.meta.url, f11WriteSchemasCarryNoTimestamp);
