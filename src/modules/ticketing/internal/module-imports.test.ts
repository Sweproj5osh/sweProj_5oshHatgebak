import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allImports, describeEdge, listTypeScriptFiles } from '../../../fitness/support/import-scanner';

const repositoryRoot = process.cwd();
const moduleFolder = path.join(repositoryRoot, 'src', 'modules', 'ticketing');
/** The entry point, after the restructure (ADR-16): the HTTP pipeline, the composition root and its test support. */
const entryPointFolders = ['http', 'composition', 'test-support'].map((folder) => path.join(repositoryRoot, 'src', 'server', folder) + path.sep);

/**
 * P5: a module's production files import the operation contract from the shared code, never from the entry point.
 * The two transitional re-export paths (docs/team/QUESTIONS.md item 15) were removed by the restructure (ADR-16).
 */
describe('ticketing production files do not import the entry point', () => {
  it('finds no import whose target lies under src/entrypoint', async () => {
    const productionFiles = (await listTypeScriptFiles(moduleFolder, () => false)).filter((file) => !file.endsWith('.test.ts'));
    const imports = await allImports(productionFiles);
    const entryPointImports = imports
      .filter((edge) => edge.target !== undefined && entryPointFolders.some((folder) => edge.target?.startsWith(folder)))
      .map((edge) => describeEdge(repositoryRoot, edge));
    expect(entryPointImports).toEqual([]);
    expect(productionFiles.length).toBeGreaterThan(0);
  });
});
