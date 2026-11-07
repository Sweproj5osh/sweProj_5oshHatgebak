/**
 * Detection of timestamp-looking data in request bodies and request schemas (Rule I).
 * Used by the entry point (reject at run time, whatever the declared kind: an epoch number under `created_at` is a
 * time taken from a client) and by fitness function F11 (reject at build time).
 */

/** Words that name a time when they stand alone or end a field name, in any case or word separator. */
const TIME_WORDS = ['time', 'timestamp', 'epoch', 'date'];
const AT = 'at';

const ISO_8601_DATE_OR_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** `closedAt`, `closed_at`, `CLOSED_AT`, `at`, `entryTime`, `exit_time`, `startDate`, `epoch`, `timestamp`; not `format` or `seat`. */
export function looksLikeTimestampKey(key: string): boolean {
  const words = wordsOf(key);
  const lastWord = words[words.length - 1];
  if (lastWord === AT) {
    return true;
  }
  const lowered = key.toLowerCase();
  return TIME_WORDS.some((word) => words.includes(word) || lowered.endsWith(word));
}

/** Splits snake_case, camelCase and UPPER_CASE names into lower-cased words. */
function wordsOf(key: string): string[] {
  return key
    .split(/[_\s-]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

export function looksLikeIso8601(value: unknown): boolean {
  return typeof value === 'string' && ISO_8601_DATE_OR_DATE_TIME.test(value);
}

/** Returns the dotted paths of every field in `body` whose key or value looks like a timestamp. */
export function findTimestampFields(body: unknown, pathPrefix = ''): string[] {
  if (Array.isArray(body)) {
    return body.flatMap((item, index) => findTimestampFields(item, `${pathPrefix}[${index}]`));
  }
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  return Object.entries(body).flatMap(([key, value]) => {
    const path = pathPrefix === '' ? key : `${pathPrefix}.${key}`;
    if (looksLikeTimestampKey(key) || looksLikeIso8601(value)) {
      return [path];
    }
    return findTimestampFields(value, path);
  });
}
