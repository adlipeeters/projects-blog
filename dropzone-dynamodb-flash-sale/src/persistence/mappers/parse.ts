/**
 * The one place a stored item becomes a domain object.
 *
 * Every read is parsed (spec section 3). An item that does not match its schema throws
 * `CorruptItemError` naming the key, so a bad or legacy item surfaces loudly instead of leaking
 * `undefined` into the domain and failing somewhere unrelated three calls later.
 */

import type { z } from 'zod';

import { CorruptItemError } from '../../shared/errors.js';
import { KEY_ATTRIBUTES } from '../keys.js';

/** Best-effort key extraction, so the error can say which item was wrong. */
const keyOf = (raw: unknown): Record<string, string> => {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const key: Record<string, string> = {};
  for (const attribute of KEY_ATTRIBUTES) {
    const value = record[attribute];
    if (typeof value === 'string') {
      key[attribute] = value;
    }
  }
  return key;
};

const describe = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');

/** Parses the item's shape. Throws CorruptItemError with the key on any mismatch. */
export function parseItem<T>(schema: z.ZodType<T>, entityType: string, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new CorruptItemError(entityType, keyOf(raw), describe(result.error));
  }
  return result.data;
}

/**
 * Wraps the step after parsing, where validated strings become branded ids and money.
 *
 * Those constructors throw ValidationError, which is a 400 for a request body but a 500 for an item
 * already in the table: the request was fine, the stored data is not.
 */
export function buildDomain<T>(entityType: string, raw: unknown, build: () => T): T {
  try {
    return build();
  } catch (error: unknown) {
    throw new CorruptItemError(
      entityType,
      keyOf(raw),
      error instanceof Error ? error.message : String(error),
    );
  }
}
