// Planted violation for F8: a must-stay-on module imports a may-fail module, even through its public.ts.
import type { Notifier } from '../../notifications/public';

export function closeAndNotify(notifier: Notifier): Notifier {
  return notifier;
}
