/** Test-only: the names shared by the run's global set-up and every test file (no test-runner import here). */

/** The login role the tests' applications connect as: a member of `sayes_application` and nothing more. */
export const TEST_APPLICATION_ROLE = 'sayes_test_application';
export const TEST_APPLICATION_PASSWORD = 'sayes-test-application-only';

export function testRunPrefix(run: string): string {
  return `sayes_test_${run}_`;
}

export function urlFor(baseUrl: string, database: string, credentials?: { user: string; password: string }): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  if (credentials !== undefined) {
    url.username = credentials.user;
    url.password = credentials.password;
  }
  return url.toString();
}
