import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  it('sorts keys at every depth so that key order never changes the bytes', () => {
    const first = canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 2 } });
    const second = canonicalJson({ a: { c: 2, d: [{ y: 2, z: 1 }] }, b: 1 });
    expect(first).toBe(second);
    expect(first).toBe('{"a":{"c":2,"d":[{"y":2,"z":1}]},"b":1}');
  });

  it('drops undefined values the same way JSON.stringify does', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});
