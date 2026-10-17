import { describe, expect, it } from 'vitest';

import { requestHash } from '../../src/shared/request-hash.js';

describe('request hash', () => {
  it('ignores property order, so a reordered body is still the same request', () => {
    expect(requestHash({ a: 1, b: 2 })).toBe(requestHash({ b: 2, a: 1 }));
    expect(requestHash({ lines: [{ sku: 'A', qty: 1 }] })).toBe(
      requestHash({ lines: [{ qty: 1, sku: 'A' }] }),
    );
  });

  it('respects array order, because line order is part of the request', () => {
    expect(requestHash([1, 2])).not.toBe(requestHash([2, 1]));
  });

  it('changes when any value changes', () => {
    const base = { lines: [{ sku: 'A', qty: 1 }] };

    expect(requestHash(base)).not.toBe(requestHash({ lines: [{ sku: 'A', qty: 2 }] }));
    expect(requestHash(base)).not.toBe(requestHash({ lines: [{ sku: 'B', qty: 1 }] }));
  });

  it('treats an absent field and an undefined field as the same', () => {
    expect(requestHash({ sku: 'A', cartId: undefined })).toBe(requestHash({ sku: 'A' }));
  });
});
