// Planted violation for F2: a module imports another module's private file instead of its public.ts.
import { isVisibleTo } from '../../audit-log/internal/read-scope';

export const peek = isVisibleTo;
