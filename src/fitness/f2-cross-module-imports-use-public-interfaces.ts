import path from 'node:path';
import { defineFitnessFunction } from './support/fitness-result';
import {
  allImports,
  describeEdge,
  isPublicInterfaceOf,
  isUnderFixtures,
  listTypeScriptFiles,
  moduleOf,
} from './support/import-scanner';
import { runWhenInvokedDirectly } from './support/run-as-script';

/** F2: a file outside module M may import from M only through src/modules/M/public.ts (ADR-03). */
export const f2CrossModuleImportsUsePublicInterfaces = defineFitnessFunction(
  'F2',
  'cross-module imports go only through public.ts',
  async (repositoryRoot) => {
    const files = await listTypeScriptFiles(path.join(repositoryRoot, 'src'), (file) => isUnderFixtures(repositoryRoot, file));
    const imports = await allImports(files);
    const violations = imports
      .filter((edge) => {
        const targetModule = moduleOf(repositoryRoot, edge.target);
        const crossesIntoModule = targetModule !== undefined && moduleOf(repositoryRoot, edge.importer) !== targetModule;
        return crossesIntoModule && edge.target !== undefined && !isPublicInterfaceOf(repositoryRoot, targetModule, edge.target);
      })
      .map((edge) => `${describeEdge(repositoryRoot, edge)}, a private file of module ${moduleOf(repositoryRoot, edge.target)}`);
    return { violations, checked: imports.length };
  },
);

runWhenInvokedDirectly(import.meta.url, f2CrossModuleImportsUsePublicInterfaces);
