import type { HttpMethod, Operation, PublicWriteOperation, ReadOperation, TelemetryOperation, WriteOperation } from '../shared/operation-contract';

/** A route found for a request: the operation and the values of the path's `:name` segments (ADR-22). */
export interface RouteMatch {
  readonly operation: Operation;
  readonly pathParameters: Readonly<Record<string, string>>;
}

/** One registered path cut into segments; a segment that starts with ":" names a parameter. */
interface Template {
  readonly method: HttpMethod;
  readonly segments: readonly string[];
  readonly operation: Operation;
}

const PARAMETER_PREFIX = ':';

export class OperationRegistry {
  /** Every operation in registration order: the order the modules list them, which the permission table and F5 follow. */
  private readonly ordered: Operation[] = [];
  private readonly byStaticRoute = new Map<string, Operation>();
  /** Parameterised routes, the most specific (most fixed segments) first, so `/sites/:siteId/status` wins over `/sites/:a/:b`. */
  private readonly templates: Template[] = [];
  private readonly claimedRoutes = new Set<string>();

  constructor(operations: readonly Operation[]) {
    for (const operation of operations) {
      this.register(operation);
    }
    this.templates.sort((left, right) => fixedSegmentsOf(right) - fixedSegmentsOf(left));
  }

  /** The route for a request: a fixed path first, then the most specific template whose fixed segments all match. */
  match(method: HttpMethod, path: string): RouteMatch | undefined {
    const fixed = this.byStaticRoute.get(routeKey(method, path));
    if (fixed !== undefined) {
      return { operation: fixed, pathParameters: {} };
    }
    const segments = path.split('/');
    for (const template of this.templates) {
      const pathParameters = template.method === method ? parametersOf(template.segments, segments) : undefined;
      if (pathParameters !== undefined) {
        return { operation: template.operation, pathParameters };
      }
    }
    return undefined;
  }

  find(method: HttpMethod, path: string): Operation | undefined {
    return this.match(method, path)?.operation;
  }

  all(): readonly Operation[] {
    return [...this.ordered];
  }

  reads(): readonly ReadOperation[] {
    return this.all().filter((operation): operation is ReadOperation => operation.kind === 'read');
  }

  writes(): readonly WriteOperation[] {
    return this.all().filter((operation): operation is WriteOperation => operation.kind === 'write');
  }

  publicWrites(): readonly PublicWriteOperation[] {
    return this.all().filter((operation): operation is PublicWriteOperation => operation.kind === 'public');
  }

  telemetry(): readonly TelemetryOperation[] {
    return this.all().filter((operation): operation is TelemetryOperation => operation.kind === 'telemetry');
  }

  private register(operation: Operation): void {
    const key = routeKey(operation.method, normalised(operation.path));
    if (this.claimedRoutes.has(key)) {
      throw new Error(`Two operations claim the route ${key}`);
    }
    this.claimedRoutes.add(key);
    this.ordered.push(operation);
    const segments = operation.path.split('/');
    if (segments.some(isParameter)) {
      this.templates.push({ method: operation.method, segments, operation });
    } else {
      this.byStaticRoute.set(key, operation);
    }
  }
}

function routeKey(method: HttpMethod, path: string): string {
  return `${method} ${path}`;
}

function isParameter(segment: string): boolean {
  return segment.startsWith(PARAMETER_PREFIX);
}

/** Two templates that differ only in their parameters' names are the same route. */
function normalised(path: string): string {
  return path
    .split('/')
    .map((segment) => (isParameter(segment) ? PARAMETER_PREFIX : segment))
    .join('/');
}

function fixedSegmentsOf(template: Template): number {
  return template.segments.filter((segment) => !isParameter(segment)).length;
}

/** The parameters when every segment matches (a parameter takes one non-empty, decodable segment), otherwise undefined. */
function parametersOf(template: readonly string[], segments: readonly string[]): Record<string, string> | undefined {
  if (template.length !== segments.length) {
    return undefined;
  }
  const parameters: Record<string, string> = {};
  for (const [index, expected] of template.entries()) {
    const actual = segments[index] ?? '';
    if (!isParameter(expected)) {
      if (actual !== expected) return undefined;
      continue;
    }
    const value = decoded(actual);
    if (value === undefined || value === '') return undefined;
    parameters[expected.slice(PARAMETER_PREFIX.length)] = value;
  }
  return parameters;
}

/** A malformed percent-encoding matches no route, so the request is answered 404 after the token check. */
function decoded(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}
