export const POSTGRES_URL_VARIABLE = 'POSTGRES_URL';

/** The one database connection the system runs on (ADR-21). There is no fallback: without it, nothing starts. */
export function readPostgresUrl(environment: NodeJS.ProcessEnv): string {
  const url = environment[POSTGRES_URL_VARIABLE];
  if (url === undefined || url.trim() === '') {
    throw new Error(`${POSTGRES_URL_VARIABLE} must be set: the system runs only against PostgreSQL and never on in-memory storage (docs/setup/database.md)`);
  }
  return url;
}

/** The connection string without its password, for messages and logs. */
export function withoutPassword(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password !== '') {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '(an unreadable connection string)';
  }
}
