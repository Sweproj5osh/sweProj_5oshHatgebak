import type { HttpMethod, Operation, WriteOperation } from '../../shared/operation-contract';

export class OperationRegistry {
  private readonly byRoute = new Map<string, Operation>();

  constructor(operations: readonly Operation[]) {
    for (const operation of operations) {
      this.register(operation);
    }
  }

  find(method: HttpMethod, path: string): Operation | undefined {
    return this.byRoute.get(routeKey(method, path));
  }

  all(): readonly Operation[] {
    return [...this.byRoute.values()];
  }

  writes(): readonly WriteOperation[] {
    return this.all().filter((operation): operation is WriteOperation => operation.kind === 'write');
  }

  private register(operation: Operation): void {
    const key = routeKey(operation.method, operation.path);
    if (this.byRoute.has(key)) {
      throw new Error(`Two operations claim the route ${key}`);
    }
    this.byRoute.set(key, operation);
  }
}

function routeKey(method: HttpMethod, path: string): string {
  return `${method} ${path}`;
}
