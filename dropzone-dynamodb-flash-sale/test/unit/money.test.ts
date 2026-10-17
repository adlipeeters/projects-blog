import { describe, expect, it } from 'vitest';

import { EUR, add, format, money, sum, times, zero } from '../../src/domain/money.js';

describe('money', () => {
  it('holds whole cents only', () => {
    expect(money(4999)).toEqual({ amountCents: 4999, currency: EUR });
    expect(zero()).toEqual({ amountCents: 0, currency: EUR });

    // The float bug this type exists to prevent: 49.99 euros is 4999 cents, never 49.99.
    expect(() => money(49.99)).toThrow('whole number of cents');
    expect(() => money(-1)).toThrow('cannot be negative');
  });

  it('adds without drifting', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004. In cents it is exactly 30.
    const total = add(money(10), money(20));

    expect(total.amountCents).toBe(30);
    expect(sum([money(1999), money(1999), money(1999)]).amountCents).toBe(5997);
    expect(sum([]).amountCents).toBe(0);
  });

  it('multiplies by a whole quantity', () => {
    expect(times(money(4999), 3).amountCents).toBe(14997);

    expect(() => times(money(4999), 0)).toThrow('positive whole number');
    expect(() => times(money(4999), 1.5)).toThrow('positive whole number');
  });

  it('formats for display only', () => {
    expect(format(money(4999))).toBe('49.99 EUR');
    expect(format(money(5))).toBe('0.05 EUR');
  });
});
