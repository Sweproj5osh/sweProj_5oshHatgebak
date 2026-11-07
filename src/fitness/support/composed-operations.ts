import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const COMPOSITION_MODULE = path.join('src', 'entrypoint', 'composition.ts');
export const REGISTRY_FACTORY_EXPORT = 'composeInMemoryRegistry';

/** An operation as the static fitness functions see it: its declarations only, never its handler. */
export interface DeclaredOperation {
  readonly kind: string;
  readonly name: string;
  readonly allowedRoles?: readonly string[];
  readonly bodySchema?: { readonly fields: Readonly<Record<string, unknown>> };
  readonly audit?: { readonly omit?: readonly string[]; readonly replace?: Readonly<Record<string, string>> };
}

interface RegistryLike {
  all(): readonly DeclaredOperation[];
}

/**
 * Loads the repository's composition root and asks it for the composed registry, so that every declaration-reading
 * fitness function (F11, F12, F13) inspects exactly the operations the server runs (P4).
 */
export async function loadComposedOperations(repositoryRoot: string): Promise<readonly DeclaredOperation[]> {
  const modulePath = path.join(repositoryRoot, COMPOSITION_MODULE);
  const loaded = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
  const factory = loaded[REGISTRY_FACTORY_EXPORT];
  if (typeof factory !== 'function') {
    throw new Error(`${modulePath} must export a function named ${REGISTRY_FACTORY_EXPORT}`);
  }
  return (factory() as RegistryLike).all();
}

export function fieldNamesOf(operation: DeclaredOperation): readonly string[] {
  return Object.keys(operation.bodySchema?.fields ?? {});
}
