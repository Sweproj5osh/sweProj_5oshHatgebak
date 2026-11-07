import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allImports, describeEdge, listTypeScriptFiles } from '../../fitness/support/import-scanner';

/**
 * P14: everything in src/apps/test-support is a stand-in for a server that is not on main yet, or a fake for a test.
 * A screen must not be able to reach it, so no file under src/apps outside this folder and outside test files may
 * import it. Fitness function F2 does not cover the apps, hence this unit test.
 */
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const APPS_FOLDER = path.join(REPOSITORY_ROOT, 'src', 'apps');
const TEST_SUPPORT_FOLDER = path.join(APPS_FOLDER, 'test-support');
const TEST_FILE_SUFFIX = '.test.ts';

function isUnderTestSupport(filePath: string): boolean {
  return filePath.startsWith(TEST_SUPPORT_FOLDER + path.sep);
}

describe('src/apps/test-support is imported by test files only (P14)', () => {
  it('no production file under src/apps imports test-support', async () => {
    const productionFiles = await listTypeScriptFiles(APPS_FOLDER, (file) => isUnderTestSupport(file) || file.endsWith(TEST_FILE_SUFFIX));
    const imports = await allImports(productionFiles);

    const violations = imports
      .filter((edge) => edge.target !== undefined && isUnderTestSupport(edge.target))
      .map((edge) => describeEdge(REPOSITORY_ROOT, edge));

    expect(productionFiles.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('no production file under src/apps imports src/entrypoint (the apps reach the server over HTTP only)', async () => {
    const productionFiles = await listTypeScriptFiles(APPS_FOLDER, (file) => file.endsWith(TEST_FILE_SUFFIX));
    const imports = await allImports(productionFiles);
    const entryPoint = path.join(REPOSITORY_ROOT, 'src', 'entrypoint') + path.sep;

    const violations = imports
      .filter((edge) => edge.target !== undefined && edge.target.startsWith(entryPoint))
      .map((edge) => describeEdge(REPOSITORY_ROOT, edge));

    expect(violations).toEqual([]);
  });
});
