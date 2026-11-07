import { describe, expect, it } from 'vitest';
import { KeyedSerialQueue } from './keyed-serial-queue';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('KeyedSerialQueue', () => {
  it('runs tasks under one key in order and tasks under other keys without waiting', async () => {
    const queue = new KeyedSerialQueue();
    const order: string[] = [];
    let releaseFirst = () => undefined as void;
    const first = queue.run('a', () => new Promise<void>((resolve) => { releaseFirst = () => { order.push('a1'); resolve(); }; }));
    const second = queue.run('a', async () => { order.push('a2'); });
    const other = queue.run('b', async () => { order.push('b1'); });
    await other;
    await settle();
    expect(order).toEqual(['b1']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['b1', 'a1', 'a2']);
  });

  it('keeps running under a key after a task throws, and hands the error to that task\'s caller only', async () => {
    const queue = new KeyedSerialQueue();
    const failing = queue.run('a', async () => { throw new Error('first failed'); });
    const next = queue.run('a', async () => 'second ran');
    await expect(failing).rejects.toThrow('first failed');
    expect(await next).toBe('second ran');
  });
});
