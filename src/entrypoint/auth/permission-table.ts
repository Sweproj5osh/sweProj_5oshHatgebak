import type { Role } from '../../shared/identifiers';
import { requiresARole, type Operation } from '../../shared/operation-contract';

/**
 * Role → the operations that role may call. Checked before any module runs (ADR-10). One table to review.
 * A public operation has no row: nobody is signed in when it runs, and fitness function F13 keeps that list at two.
 */
export class PermissionTable {
  private readonly rolesByOperation = new Map<string, ReadonlySet<Role>>();

  constructor(operations: readonly Operation[]) {
    for (const operation of operations.filter(requiresARole)) {
      this.rolesByOperation.set(operation.name, new Set(operation.allowedRoles));
    }
  }

  allows(role: Role, operationName: string): boolean {
    return this.rolesByOperation.get(operationName)?.has(role) ?? false;
  }

  operationCount(): number {
    return this.rolesByOperation.size;
  }

  entries(): readonly { operation: string; roles: readonly Role[] }[] {
    return [...this.rolesByOperation].map(([operation, roles]) => ({ operation, roles: [...roles] }));
  }
}
