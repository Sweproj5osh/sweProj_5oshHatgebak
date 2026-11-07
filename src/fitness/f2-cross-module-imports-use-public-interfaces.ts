import path from 'node:path';
import { defineFitnessFunction } from './support/fitness-result';
import {
  allImports,
  describeEdge,
  isPublicInterfaceOf,
  isUnderFixtures,
  listTypeScriptFiles,
  moduleOf,
  type ImportEdge,
} from './support/import-scanner';
import { runWhenInvokedDirectly } from './support/run-as-script';

const FOLDERS_THAT_NEVER_IMPORT_THE_ENTRY_POINT = [path.join('src', 'modules'), path.join('src', 'apps')];
const ENTRY_POINT_FOLDER = path.join('src', 'entrypoint');

/**
 * Transitional (see QUESTIONS.md): the two old contract paths kept as one-line re-exports for modules already on
 * main, and test files, which still compose the application through the entry point. Both exemptions end when Zeyad
 * says so.
 */
const TRANSITIONAL_RE_EXPORT_PATHS = [path.join('src', 'entrypoint', 'operations', 'operation'), path.join('src', 'entrypoint', 'http')];
const TEST_FILE_SUFFIX = '.test.ts';

/**
 * F2: a file outside module M may import from M only through src/modules/M/public.ts (ADR-03), and no file under
 * src/modules or src/apps imports src/entrypoint (P5: the entry point depends on the modules, never the reverse).
 */
export const f2CrossModuleImportsUsePublicInterfaces = defineFitnessFunction(
  'F2',
  'cross-module imports go only through public.ts; modules and apps never import the entry point',
  async (repositoryRoot) => {
    const files = await listTypeScriptFiles(path.join(repositoryRoot, 'src'), (file) => isUnderFixtures(repositoryRoot, file));
    const imports = await allImports(files);
    const violations = [
      ...imports.filter((edge) => reachesIntoAnotherModulesInternals(repositoryRoot, edge)).map((edge) => describePrivateImport(repositoryRoot, edge)),
      ...imports.filter((edge) => importsTheEntryPointFromAModuleOrApp(repositoryRoot, edge)).map((edge) => describeEntryPointImport(repositoryRoot, edge)),
    ];
    return { violations, checked: imports.length };
  },
);

function reachesIntoAnotherModulesInternals(repositoryRoot: string, edge: ImportEdge): boolean {
  const targetModule = moduleOf(repositoryRoot, edge.target);
  if (targetModule === undefined || edge.target === undefined) {
    return false;
  }
  const crossesIntoModule = moduleOf(repositoryRoot, edge.importer) !== targetModule;
  return crossesIntoModule && !isPublicInterfaceOf(repositoryRoot, targetModule, edge.target);
}

function importsTheEntryPointFromAModuleOrApp(repositoryRoot: string, edge: ImportEdge): boolean {
  const importerFolder = path.relative(repositoryRoot, edge.importer);
  const importerIsModuleOrApp = FOLDERS_THAT_NEVER_IMPORT_THE_ENTRY_POINT.some((folder) => importerFolder.startsWith(folder + path.sep));
  if (!importerIsModuleOrApp || edge.importer.endsWith(TEST_FILE_SUFFIX) || edge.target === undefined) {
    return false;
  }
  return isUnderEntryPoint(repositoryRoot, edge.target) && !isTransitionalReExport(repositoryRoot, edge.target);
}

function isTransitionalReExport(repositoryRoot: string, target: string): boolean {
  return TRANSITIONAL_RE_EXPORT_PATHS.some((reExport) => target === path.join(repositoryRoot, reExport));
}

function isUnderEntryPoint(repositoryRoot: string, target: string): boolean {
  return target.startsWith(path.join(repositoryRoot, ENTRY_POINT_FOLDER) + path.sep);
}

function describePrivateImport(repositoryRoot: string, edge: ImportEdge): string {
  return `${describeEdge(repositoryRoot, edge)}, a private file of module ${moduleOf(repositoryRoot, edge.target)}`;
}

function describeEntryPointImport(repositoryRoot: string, edge: ImportEdge): string {
  return `${describeEdge(repositoryRoot, edge)}, which lies under src/entrypoint, which no module or app may import`;
}

runWhenInvokedDirectly(import.meta.url, f2CrossModuleImportsUsePublicInterfaces);
