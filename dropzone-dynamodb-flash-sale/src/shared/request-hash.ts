/**
 * The hash stored on an idempotency item, so a replayed key can be told from a reused one.
 *
 * Same key, same hash: the client is retrying, and the original order is returned. Same key,
 * different hash: the client reused a key for a different request, which is a 422 rather than a
 * silent surprise (spec section 7).
 *
 * Keys are sorted before hashing, so two bodies that differ only in property order hash the same.
 */

import { createHash } from 'node:crypto';

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
};

export const requestHash = (payload: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonical(payload)))
    .digest('hex');
