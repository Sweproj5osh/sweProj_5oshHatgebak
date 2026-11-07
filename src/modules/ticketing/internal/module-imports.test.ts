import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allImports, describeEdge, listTypeScriptFiles } from '../../../fitness/support/import-scanner';

const repositoryRoot = process.cwd();
const moduleFolder = path.join(repositoryRoot, 'src', 'modules', 'ticketing');
const entryPointFolder = path.join(repositoryRoot, 'src', 'entrypoint') + path.sep;

/**
 * P5 and fitness function F2: a module's production files import the operation contract from `src/shared`, never from
 * `src/entrypoint`. F2 still exempts the two transitional re-export paths for modules already on main (QUESTIONS.md
 * item 15); this test closes that exemption for ticketing ahead of foundation 3.
 */
describe('ticketing production files do not import the entry point', () => {
  it('finds no import whose target lies under src/entrypoint', async () => {
    const productionFiles = (await listTypeScriptFiles(moduleFolder, () => false)).filter((file) => !file.endsWith('.test.ts'));
    const imports = await allImports(productionFiles);
    const entryPointImports = imports
      .filter((edge) => edge.target !== undefined && edge.target.startsWith(entryPointFolder))
      .map((edge) => describeEdge(repositoryRoot, edge));
    expect(entryPointImports).toEqual([]);
    expect(productionFiles.length).toBeGreaterThan(0);
  });
});
