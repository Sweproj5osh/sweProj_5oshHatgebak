/**
 * Fills a route template's `:name` segments (`/tickets/:ticketId/closure`, ADR-22) from the values a request already
 * carries in its body or query, each value percent-encoded. A template that names a value the request lacks is a fault
 * in the calling code, so it throws instead of sending a request to the wrong place.
 */
export function pathWith(template: string, values: Readonly<Record<string, unknown>>): string {
  return template
    .split('/')
    .map((segment) => (segment.startsWith(':') ? encodeURIComponent(valueFor(segment.slice(1), template, values)) : segment))
    .join('/');
}

function valueFor(name: string, template: string, values: Readonly<Record<string, unknown>>): string {
  const value = values[name];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`the route ${template} needs a value for ${name}`);
  }
  return String(value);
}
