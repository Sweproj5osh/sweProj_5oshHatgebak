import path from 'node:path';
import { allFitnessFunctions } from './all-fitness-functions';
import { formatResult } from './support/fitness-result';

/** `npm run fitness`: every static fitness function against this repository; exit code 1 when any fails. */
const repositoryRoot = path.resolve(process.argv[2] ?? process.cwd());
const started = performance.now();
const results = await Promise.all(allFitnessFunctions.map((fitnessFunction) => fitnessFunction(repositoryRoot)));
results.forEach((result) => console.log(formatResult(result)));

const failed = results.filter((result) => !result.passed).length;
const totalMilliseconds = (performance.now() - started).toFixed(1);
console.log(`\nFitness: ${results.length - failed} passed, ${failed} failed, ${totalMilliseconds} ms`);
process.exitCode = failed === 0 ? 0 : 1;
