import { describe, expect, it } from 'vitest';

import { epochSeconds, ttlInDays, ttlInHours } from '../../src/shared/ttl.js';

describe('ttl values', () => {
  const at = new Date('2026-10-15T12:00:00.000Z');

  it('is epoch seconds, not milliseconds, because DynamoDB requires a Number in seconds', () => {
    expect(epochSeconds(at)).toBe(Math.floor(at.getTime() / 1000));
    // A millisecond value would be a date in the year 57000 and would never expire.
    expect(String(epochSeconds(at))).toHaveLength(10);
  });

  it('adds hours and days', () => {
    expect(ttlInHours(at, 24) - epochSeconds(at)).toBe(86_400);
    expect(ttlInDays(at, 30) - epochSeconds(at)).toBe(30 * 86_400);
  });
});
