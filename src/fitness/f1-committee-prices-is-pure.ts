import path from 'node:path';
import { PURE_MODULE } from './module-sets';
import { defineFitnessFunction } from './support/fitness-result';
import { allImports, describeEdge, isUnderFixtures, listTypeScriptFiles } from './support/import-scanner';
import { runWhenInvokedDirectly } from './support/run-as-script';

/** F1: committee-prices imports nothing outside its own folder, not even Node built-ins or src/shared (Rule C). */
export const f1CommitteePricesIsPure = defineFitnessFunction(
  'F1',
  `${PURE_MODULE} imports nothing outside its own folder`,
  async (repositoryRoot) => {
    const moduleFolder = path.join(repositoryRoot, 'src', 'modules', PURE_MODULE);
    const files = await listTypeScriptFiles(moduleFolder, (file) => isUnderFixtures(repositoryRoot, file));
    const imports = await allImports(files);
    const violations = imports
      .filter((edge) => edge.target === undefined || !edge.target.startsWith(moduleFolder + path.sep))
      .map((edge) => `${describeEdge(repositoryRoot, edge)}, which lies outside ${PURE_MODULE}`);
    return { violations, checked: files.length };
  },
);

runWhenInvokedDirectly(import.meta.url, f1CommitteePricesIsPure);
