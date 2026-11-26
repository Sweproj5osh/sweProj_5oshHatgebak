import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ImportEdge {
  /** Absolute path of the importing file. */
  readonly importer: string;
  /** What the import statement said. */
  readonly specifier: string;
  /** Absolute path of the imported file without extension, or undefined for a package or Node built-in. */
  readonly target: string | undefined;
}

const IMPORT_STATEMENT = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const SOURCE_EXTENSIONS = /\.(ts|js|mts|mjs)$/;

export const FIXTURES_FOLDER = path.join('src', 'fitness', 'fixtures');

export function isUnderFixtures(repositoryRoot: string, filePath: string): boolean {
  return filePath.startsWith(path.join(repositoryRoot, FIXTURES_FOLDER) + path.sep);
}

export async function listTypeScriptFiles(folder: string, exclude: (filePath: string) => boolean): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      files.push(...(await listTypeScriptFiles(fullPath, exclude)));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !exclude(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function importsOf(filePath: string): Promise<ImportEdge[]> {
  const source = await readFile(filePath, 'utf8');
  return [...source.matchAll(IMPORT_STATEMENT)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => specifier !== undefined)
    .map((specifier) => ({ importer: filePath, specifier, target: resolveTarget(filePath, specifier) }));
}

export async function allImports(files: readonly string[]): Promise<ImportEdge[]> {
  const perFile = await Promise.all(files.map(importsOf));
  return perFile.flat();
}

function resolveTarget(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  return path.resolve(path.dirname(importer), specifier).replace(SOURCE_EXTENSIONS, '');
}

export function describeEdge(repositoryRoot: string, edge: ImportEdge): string {
  return `${path.relative(repositoryRoot, edge.importer)} imports "${edge.specifier}"`;
}
