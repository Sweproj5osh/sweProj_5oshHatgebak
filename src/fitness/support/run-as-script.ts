import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatResult, type FitnessFunction } from './fitness-result';

/** Lets one fitness function file double as a script: `tsx src/fitness/f1-....ts [repositoryRoot]`. */
export function runWhenInvokedDirectly(importMetaUrl: string, fitnessFunction: FitnessFunction): void {
  const invokedFile = process.argv[1];
  if (invokedFile === undefined || path.resolve(invokedFile) !== fileURLToPath(importMetaUrl)) {
    return;
  }
  const repositoryRoot = path.resolve(process.argv[2] ?? process.cwd());
  fitnessFunction(repositoryRoot)
    .then((result) => {
      console.log(formatResult(result));
      process.exitCode = result.passed ? 0 : 1;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 2;
    });
}
