import type { AccountsAndAccessControl } from '../modules/accounts-and-access-control/public';
import type { AuditTrail } from '../modules/audit-log/public';
import { refuse, respond } from '../shared/operation-contract';
import { runAudited } from './audited-execution';
import type { UnitOfWorkResourcesFactory } from './unit-of-work-resources';

export const BOOTSTRAP_CHAIR_PHONE_VARIABLE = 'BOOTSTRAP_CHAIR_PHONE';
export const BOOTSTRAP_CHAIR_NAME_VARIABLE = 'BOOTSTRAP_CHAIR_NAME';

/** The one action no person triggers; it has no client, so its request id is this constant and its actor is the system. */
export const BOOTSTRAP_OPERATION = 'accounts.bootstrapChair';
const BOOTSTRAP_REQUEST_ID = 'system-bootstrap-first-chair';

export type BootstrapOutcome =
  | { readonly kind: 'bootstrapped'; readonly chairId: string }
  | { readonly kind: 'already bootstrapped' }
  | { readonly kind: 'not configured' }
  | { readonly kind: 'refused'; readonly reason: string };

export interface BootstrapDependencies {
  readonly accounts: AccountsAndAccessControl;
  readonly audit: AuditTrail;
  readonly resources: UnitOfWorkResourcesFactory;
}

/**
 * Creates the first Chair from the environment (Q2) exactly once: when both variables are set and the audit log holds
 * no bootstrap entry yet. The action is audited like any other, with `{ kind: 'system' }` as the actor and the phone
 * and name kept out of the entry; the new Chair is the entry's subject. The log is the memory of "done": the accounts
 * module offers no way to count people, so a store filled by any other means is not detected (see QUESTIONS.md).
 */
export async function bootstrapFirstChair(environment: NodeJS.ProcessEnv, dependencies: BootstrapDependencies): Promise<BootstrapOutcome> {
  const phone = environment[BOOTSTRAP_CHAIR_PHONE_VARIABLE];
  const displayName = environment[BOOTSTRAP_CHAIR_NAME_VARIABLE];
  if (phone === undefined || displayName === undefined) {
    return { kind: 'not configured' };
  }
  if (await alreadyBootstrapped(dependencies.audit)) {
    return { kind: 'already bootstrapped' };
  }
  return createTheChair(phone, displayName, dependencies);
}

async function alreadyBootstrapped(audit: AuditTrail): Promise<boolean> {
  const entries = await audit.readByScope({ personId: 'system', role: 'chair' });
  return entries.some((entry) => entry.operation === BOOTSTRAP_OPERATION);
}

async function createTheChair(phone: string, displayName: string, dependencies: BootstrapDependencies): Promise<BootstrapOutcome> {
  let chairId: string | undefined;
  const response = await runAudited(
    {
      operationName: BOOTSTRAP_OPERATION,
      actor: { kind: 'system' },
      requestId: BOOTSTRAP_REQUEST_ID,
      input: {},
      redaction: undefined,
      async run() {
        const chair = await dependencies.accounts.bootstrapChair(phone, displayName);
        if (!chair.ok) {
          return { response: refuse(409, chair.error) };
        }
        chairId = chair.value;
        return { response: respond(201, {}), audit: { subjectPersonIds: [chair.value] } };
      },
    },
    dependencies.resources,
  );
  if (chairId === undefined) {
    return { kind: 'refused', reason: String((response.body as { error?: string }).error ?? response.status) };
  }
  return { kind: 'bootstrapped', chairId };
}
