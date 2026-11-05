export interface FitnessResult {
  readonly name: string;
  readonly description: string;
  readonly passed: boolean;
  readonly violations: readonly string[];
  /** How many files, imports, columns or fields the function looked at. */
  readonly checked: number;
  readonly milliseconds: number;
}

export type FitnessFunction = (repositoryRoot: string) => Promise<FitnessResult>;

export interface Findings {
  readonly violations: readonly string[];
  readonly checked: number;
}

export function defineFitnessFunction(
  name: string,
  description: string,
  inspect: (repositoryRoot: string) => Promise<Findings>,
): FitnessFunction {
  return async (repositoryRoot) => {
    const started = performance.now();
    const findings = await inspect(repositoryRoot);
    return {
      name,
      description,
      passed: findings.violations.length === 0,
      violations: findings.violations,
      checked: findings.checked,
      milliseconds: performance.now() - started,
    };
  };
}

export function formatResult(result: FitnessResult): string {
  const verdict = result.passed ? 'PASS' : 'FAIL';
  const header = `${verdict}  ${result.name}: ${result.description} (${result.checked} checked, ${result.milliseconds.toFixed(1)} ms)`;
  return [header, ...result.violations.map((violation) => `      - ${violation}`)].join('\n');
}
