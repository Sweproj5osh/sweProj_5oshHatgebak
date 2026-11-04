/**
 * Detection of timestamp-looking data in request bodies and request schemas.
 * Used by the entry point (Z6, reject at run time) and by fitness function F11 (reject at build time).
 */

const CAMEL_CASE_AT_SUFFIX = /[a-z0-9]At$/;
const LOWER_CASE_SUFFIXES = ['time', 'date', 'timestamp'];

const ISO_8601_DATE_OR_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function looksLikeTimestampKey(key: string): boolean {
  if (key === 'at' || CAMEL_CASE_AT_SUFFIX.test(key)) {
    return true;
  }
  const lowered = key.toLowerCase();
  return LOWER_CASE_SUFFIXES.some((suffix) => lowered.endsWith(suffix));
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
