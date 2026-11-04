import path from 'node:path';
import { MAY_FAIL_MODULES, MUST_STAY_ON_MODULES } from './module-sets';
import { defineFitnessFunction } from './support/fitness-result';
import { allImports, describeEdge, isUnderFixtures, listTypeScriptFiles, moduleOf } from './support/import-scanner';
import { runWhenInvokedDirectly } from './support/run-as-script';

/** F8 (static half): no import from a must-stay-on module into a may-fail module (ADR-03, Rule D). */
export const f8MustStayOnNeverImportsMayFail = defineFitnessFunction(
  'F8-static',
  'no import from the must-stay-on set into the may-fail set',
  async (repositoryRoot) => {
    const modulesFolder = path.join(repositoryRoot, 'src', 'modules');
    const files = await listTypeScriptFiles(modulesFolder, (file) => isUnderFixtures(repositoryRoot, file));
    const imports = await allImports(files);
    const violations = imports
      .filter((edge) => {
        const importer = moduleOf(repositoryRoot, edge.importer);
        const target = moduleOf(repositoryRoot, edge.target);
        return importer !== undefined && target !== undefined && MUST_STAY_ON_MODULES.includes(importer) && MAY_FAIL_MODULES.includes(target);
      })
      .map((edge) => `${describeEdge(repositoryRoot, edge)}: must-stay-on module ${moduleOf(repositoryRoot, edge.importer)} reaches may-fail module ${moduleOf(repositoryRoot, edge.target)}`);
    return { violations, checked: imports.length };
  },
);

runWhenInvokedDirectly(import.meta.url, f8MustStayOnNeverImportsMayFail);
