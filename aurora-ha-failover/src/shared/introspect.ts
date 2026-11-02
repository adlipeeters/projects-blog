import { performance } from 'node:perf_hooks';
import type pg from 'pg';
import { z } from 'zod';

// Spec section 4. Which instance answered, and whether it is a reader. Both functions are local to
// the instance the connection landed on, so this needs no catalog lookup.
const INTROSPECT_SQL = `
  select aurora_db_instance_identifier() as instance,
         pg_is_in_recovery()             as is_reader`;

const RowSchema = z.object({ instance: z.string(), is_reader: z.boolean() });

export type Probe =
  | { ok: true; instance: string; isReader: boolean; latencyMs: number }
  | { ok: false; code: string; message: string; latencyMs: number };

interface Queryable {
  query(sql: string): Promise<pg.QueryResult>;
}

export async function introspect(target: Queryable): Promise<Probe> {
  const started = performance.now();
  try {
    const result = await target.query(INTROSPECT_SQL);
    const row = RowSchema.parse(result.rows[0]);
    return {
      ok: true,
      instance: row.instance,
      isReader: row.is_reader,
      latencyMs: elapsedMs(started),
    };
  } catch (error) {
    return { ok: false, ...describeError(error), latencyMs: elapsedMs(started) };
  }
}

// pg's own errors carry no code, so they are named from their message: the error mix is a
// reported result, and "Error" says nothing. Checked in order, timeouts first.
const UNCODED: [RegExp, string][] = [
  [/Query read timeout/, 'query_timeout'],
  [/timeout exceeded when trying to connect|due to connection timeout/, 'connect_timeout'],
  [/Connection terminated/, 'connection_terminated'],
];

/** A PostgreSQL SQLSTATE when there is one, otherwise the Node error code, otherwise a name. */
export function describeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return { code, message: error.message };
    const named = UNCODED.find(([pattern]) => pattern.test(error.message));
    if (named) return { code: named[1], message: error.message };
    return { code: error.name, message: error.message };
  }
  return { code: 'unknown', message: String(error) };
}

/** Milliseconds since a `performance.now()` reading, to one decimal. */
export function elapsedMs(started: number): number {
  return Math.round((performance.now() - started) * 10) / 10;
}
