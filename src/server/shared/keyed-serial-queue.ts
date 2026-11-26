/**
 * Runs the tasks handed in under one key one after another, while tasks under different keys run freely. A key's
 * queue is forgotten once its last task has settled, so the map never grows with the number of keys ever seen.
 */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<Value>(key: string, task: () => Promise<Value>): Promise<Value> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail: Promise<unknown> = result.catch(() => undefined).then(() => this.forgetIfLast(key, tail));
    this.tails.set(key, tail);
    return result;
  }

  private forgetIfLast(key: string, tail: Promise<unknown>): void {
    if (this.tails.get(key) === tail) {
      this.tails.delete(key);
    }
  }
}
