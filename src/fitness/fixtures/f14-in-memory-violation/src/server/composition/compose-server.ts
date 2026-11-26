// Planted violation for F14: the composition root wires a storage adapter other than PostgreSQL.
import { InMemoryDatabase } from '../adapters/in-memory/in-memory-database';

export const storage = new InMemoryDatabase();
