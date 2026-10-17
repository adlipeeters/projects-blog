/**
 * Pagination cursors: the `LastEvaluatedKey`, JSON-encoded then base64url-encoded, and validated on
 * the way back in (spec section 3).
 *
 * Opaque on purpose. A client that cannot read the cursor cannot come to depend on the key format,
 * which leaves the schema free to change. Validation matters because the value goes straight into
 * an `ExclusiveStartKey`: it is attacker-controlled input reaching the database layer.
 */

import { z } from 'zod';

import { ValidationError } from './errors.js';

/** A DynamoDB key is a small flat object of strings and numbers, never nested. */
const cursorSchema = z.record(z.string().min(1), z.union([z.string(), z.number()]));

export type Cursor = z.infer<typeof cursorSchema>;

export const encodeCursor = (
  lastEvaluatedKey: Record<string, unknown> | undefined,
): string | null =>
  lastEvaluatedKey === undefined
    ? null
    : Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64url');

export function decodeCursor(cursor: string | undefined): Cursor | undefined {
  if (cursor === undefined || cursor.length === 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('Invalid pagination cursor');
  }

  const result = cursorSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError('Invalid pagination cursor');
  }
  return result.data;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function pageSize(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new ValidationError(`Limit must be a whole number between 1 and ${MAX_PAGE_SIZE}`, {
      limit,
    });
  }
  return limit;
}

export type Page<T> = {
  readonly items: readonly T[];
  /** Null when there is nothing more to read. */
  readonly cursor: string | null;
};
