import type { ResponseStore, StoredResponse } from '../../entrypoint/repeatable-writes/response-store';

export class InMemoryResponseStore implements ResponseStore {
  private readonly responses = new Map<string, StoredResponse>();

  async find(responseKey: string): Promise<StoredResponse | undefined> {
    return this.responses.get(responseKey);
  }

  async save(responseKey: string, stored: StoredResponse): Promise<void> {
    this.responses.set(responseKey, stored);
  }
}
