import path from 'node:path';
import { defineFitnessFunction } from './support/fitness-result';
import { allImports, describeEdge, isUnderFixtures, listTypeScriptFiles } from './support/import-scanner';
import { runWhenInvokedDirectly } from './support/run-as-script';

const TEST_FILE_SUFFIX = '.test.ts';
/** Folders whose files serve tests only: stand-ins, fakes, test worlds and the fitness functions themselves. */
const TEST_ONLY_FOLDERS = ['test-support', 'testing'];
const FITNESS_FOLDER = path.join('src', 'fitness');
/** The composition root wires storage, and only the PostgreSQL adapters may be wired (ADR-21: no in-memory storage). */
const COMPOSITION_FOLDER = path.join('src', 'server', 'composition');
const ADAPTERS_FOLDER = path.join('src', 'server', 'adapters');
const POSTGRES_ADAPTERS_FOLDER = path.join(ADAPTERS_FOLDER, 'postgres');

/**
 * F14 (ADR-16, ADR-21): no production file imports test-only code, so the running application can never reach a
 * stand-in, a fake or a test world, and the composition root wires no storage adapter but the PostgreSQL ones. Test-only
 * code is a `*.test.ts` file, anything in a `test-support/` or `testing/` folder, and `src/fitness`.
 */
export const f14ProductionCodeNeverReachesTestCode = defineFitnessFunction(
  'F14',
  'no production file imports test-only code; the composition root wires only PostgreSQL adapters',
  async (repositoryRoot) => {
    const isTestOnly = (file: string) => isTestOnlyFile(repositoryRoot, file);
    const productionFiles = await listTypeScriptFiles(path.join(repositoryRoot, 'src'), (file) => isUnderFixtures(repositoryRoot, file) || isTestOnly(file));
    const imports = await allImports(productionFiles);
    const violations = [
      ...imports
        .filter((edge) => edge.target !== undefined && isTestOnly(`${edge.target}.ts`))
        .map((edge) => `${describeEdge(repositoryRoot, edge)}, which is test-only code`),
      ...imports
        .filter((edge) => wiresAnotherStorage(repositoryRoot, edge.importer, edge.target))
        .map((edge) => `${describeEdge(repositoryRoot, edge)}, a storage adapter other than PostgreSQL`),
    ];
    return { violations, checked: imports.length };
  },
);

function wiresAnotherStorage(repositoryRoot: string, importer: string, target: string | undefined): boolean {
  const inside = (file: string, folder: string) => path.relative(repositoryRoot, file).startsWith(folder + path.sep);
  return target !== undefined && inside(importer, COMPOSITION_FOLDER) && inside(target, ADAPTERS_FOLDER) && !inside(target, POSTGRES_ADAPTERS_FOLDER);
}

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
