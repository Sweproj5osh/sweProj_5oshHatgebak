import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../shared/canonical-json';
import type { Clock } from '../../../shared/clock';
import { SerialQueue } from '../../../shared/serial-queue';
import type { AuditActor, AuditEntry, AuditLogStore, AuditReader, AuditRecord, AuditTrail, ChainHead } from '../public';
import { isVisibleTo } from './read-scope';

/** The previous hash of the very first entry. */
export const GENESIS_HASH = '0'.repeat(64);

export function createHashChainedAuditTrail(store: AuditLogStore, clock: Clock): AuditTrail {
  return new HashChainedAuditTrail(store, clock);
}

class HashChainedAuditTrail implements AuditTrail {
  /** Appends through one trail never interleave: read the last record, chain, write, then the next one starts. */
  private readonly appends = new SerialQueue();

  constructor(
    private readonly store: AuditLogStore,
    private readonly clock: Clock,
  ) {}

  append(entry: AuditEntry): Promise<AuditRecord> {
    return this.appends.run(() => this.appendAfterLast(entry));
  }

  private async appendAfterLast(entry: AuditEntry): Promise<AuditRecord> {
    const previous = await this.store.lastRecord();
    const record = chainAfter(previous, entry, this.clock.now());
    await this.store.appendRecord(record);
    return record;
  }

  async verifyChain(): Promise<boolean> {
    const records = await this.store.readAll();
    let expectedPrevHash = GENESIS_HASH;
    for (const record of records) {
      const { hash: storedHash, ...hashedFields } = record;
      if (record.prevHash !== expectedPrevHash || hashOf(hashedFields) !== storedHash) {
        return false;
      }
      expectedPrevHash = storedHash;
    }
    return headNames(await this.store.head(), records[records.length - 1]);
  }

  async readByScope(reader: AuditReader): Promise<readonly AuditRecord[]> {
    const all = await this.store.readAll();
    return all.filter((record) => isVisibleTo(reader, record));
  }
}

/** A cut at the tail leaves a chain that still verifies link by link; only the head, moved by every append, tells. */
function headNames(head: ChainHead | undefined, last: AuditRecord | undefined): boolean {
  if (last === undefined) {
    return head === undefined;
  }
  return head !== undefined && head.lastId === last.id && head.lastHash === last.hash;
}

function chainAfter(previous: AuditRecord | undefined, entry: AuditEntry, recordedAt: Date): AuditRecord {
  const { actor, ...fields } = entry;
  const unhashed = {
    ...fields,
    ...flattened(actor),
    id: previous === undefined ? 1 : previous.id + 1,
    recordedAt: recordedAt.toISOString(),
    prevHash: previous === undefined ? GENESIS_HASH : previous.hash,
  };
  return { ...unhashed, hash: hashOf(unhashed) };
}

/** The actor as the table stores it: its kind, then two columns for a person or one for an anonymous caller. */
function flattened(actor: AuditActor): Pick<AuditRecord, 'actorKind' | 'personId' | 'role' | 'address'> {
  switch (actor.kind) {
    case 'person':
      return { actorKind: 'person', personId: actor.personId, role: actor.role };
    case 'anonymous':
      return { actorKind: 'anonymous', address: actor.address };
    case 'system':
      return { actorKind: 'system' };
  }
}

type HashedFields = Omit<AuditRecord, 'hash'>;

/** SHA-256 over the previous hash followed by the canonical JSON of every other field. */
function hashOf(record: HashedFields): string {
  const { prevHash, ...fields } = record;
  return createHash('sha256').update(prevHash).update(canonicalJson(fields)).digest('hex');
}
