import type { PersonId, Role } from '../../../shared/identifiers';
import type { TableAccess } from '../../../shared/unit-of-work';
import { createAccountsStores } from './index';

/** Seeds the person a sample request of the F5 harness acts as, or acts on, through this module's own stores (P26 Q10). */
export async function seedPerson(database: TableAccess, personId: PersonId, role: Role, phone: string): Promise<void> {
  const stores = createAccountsStores();
  await stores.people.add(database, { personId, role, status: 'active', erased: false });
  await stores.personalData.addDetails(database, { personRef: personId, displayName: `${role} ${personId}`, phone });
}
