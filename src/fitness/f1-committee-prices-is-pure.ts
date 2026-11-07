import path from 'node:path';
import { PURE_MODULE } from './module-sets';
import { defineFitnessFunction } from './support/fitness-result';
import { allImports, describeEdge, isUnderFixtures, listTypeScriptFiles } from './support/import-scanner';
import { runWhenInvokedDirectly } from './support/run-as-script';

/** Test files import the test runner, so they live beside the module and F1 leaves them out (P28 #28). */
const TEST_FILE_SUFFIX = '.test.ts';

/**
 * F1: the production files of committee-prices import nothing outside the module's own folder, not even Node built-ins
 * or src/shared (Rule C). Its `*.test.ts` files are skipped.
 */
export const f1CommitteePricesIsPure = defineFitnessFunction(
  'F1',
  `${PURE_MODULE} production files import nothing outside the module's own folder`,
  async (repositoryRoot) => {
    const moduleFolder = path.join(repositoryRoot, 'src', 'modules', PURE_MODULE);
    const files = await listTypeScriptFiles(moduleFolder, (file) => isUnderFixtures(repositoryRoot, file) || file.endsWith(TEST_FILE_SUFFIX));
    const imports = await allImports(files);
    const violations = imports
      .filter((edge) => edge.target === undefined || !edge.target.startsWith(moduleFolder + path.sep))
      .map((edge) => `${describeEdge(repositoryRoot, edge)}, which lies outside ${PURE_MODULE}`);
    return { violations, checked: files.length };
  },
);

runWhenInvokedDirectly(import.meta.url, f1CommitteePricesIsPure);
