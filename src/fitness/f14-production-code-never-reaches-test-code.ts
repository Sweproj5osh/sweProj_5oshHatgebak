import path from 'node:path';
import { defineFitnessFunction } from './support/fitness-result';
import { allImports, describeEdge, isUnderFixtures, listTypeScriptFiles } from './support/import-scanner';
import { runWhenInvokedDirectly } from './support/run-as-script';

const TEST_FILE_SUFFIX = '.test.ts';
/** Folders whose files serve tests only: stand-ins, fakes, test worlds and the fitness functions themselves. */
const TEST_ONLY_FOLDERS = ['test-support', 'testing'];
const FITNESS_FOLDER = path.join('src', 'fitness');

/**
 * F14 (ADR-16, ADR-21): no production file imports test-only code, so the running application can never reach a
 * stand-in, a fake or a test world. Test-only code is a `*.test.ts` file, anything in a `test-support/` or `testing/`
 * folder, and `src/fitness`.
 */
export const f14ProductionCodeNeverReachesTestCode = defineFitnessFunction(
  'F14',
  'no production file imports test-only code',
  async (repositoryRoot) => {
    const isTestOnly = (file: string) => isTestOnlyFile(repositoryRoot, file);
    const productionFiles = await listTypeScriptFiles(path.join(repositoryRoot, 'src'), (file) => isUnderFixtures(repositoryRoot, file) || isTestOnly(file));
    const imports = await allImports(productionFiles);
    const violations = imports
      .filter((edge) => edge.target !== undefined && isTestOnly(`${edge.target}.ts`))
      .map((edge) => `${describeEdge(repositoryRoot, edge)}, which is test-only code`);
    return { violations, checked: imports.length };
  },
);

function isTestOnlyFile(repositoryRoot: string, file: string): boolean {
  const relative = path.relative(repositoryRoot, file);
  const folders = path.dirname(relative).split(path.sep);
  return (
    relative.endsWith(TEST_FILE_SUFFIX) ||
    folders.some((folder) => TEST_ONLY_FOLDERS.includes(folder)) ||
    relative.startsWith(FITNESS_FOLDER + path.sep)
  );
}

runWhenInvokedDirectly(import.meta.url, f14ProductionCodeNeverReachesTestCode);
