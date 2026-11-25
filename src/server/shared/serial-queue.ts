/** Runs asynchronous tasks one after another in the order they were handed in, even when callers do not await. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<Value>(task: () => Promise<Value>): Promise<Value> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
