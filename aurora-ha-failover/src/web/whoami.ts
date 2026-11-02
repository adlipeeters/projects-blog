import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { z } from 'zod';
import type { Hosts, Via } from '../shared/db.js';
import { describeError, elapsedMs, introspect, type Probe } from '../shared/introspect.js';
import type { InstanceAzs, TaskIdentity } from '../shared/topology.js';

export const WhoAmIQuerySchema = z.object({
  via: z.enum(['direct', 'proxy']).default('direct'),
  fresh: z.enum(['0', '1']).default('0'),
});

const NodeSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    endpoint: z.string(),
    instance: z.string(),
    az: z.string(),
    isReader: z.boolean(),
    latencyMs: z.number(),
  }),
  z.object({
    ok: z.literal(false),
    endpoint: z.string(),
    code: z.string(),
    message: z.string(),
    latencyMs: z.number(),
  }),
]);

export const WhoAmISchema = z.object({
  at: z.string(),
  via: z.enum(['direct', 'proxy']),
  fresh: z.boolean(),
  app: z.object({ taskId: z.string(), az: z.string() }),
  writer: NodeSchema,
  reader: NodeSchema,
});

export type WhoAmI = z.infer<typeof WhoAmISchema>;

/** One writer pool and one reader pool per way of connecting. */
export interface Route {
  hosts: Hosts;
  base: pg.ClientConfig;
  writer: pg.Pool;
  reader: pg.Pool;
}

export interface WhoAmIDeps {
  task: TaskIdentity;
  azs: InstanceAzs;
}

/**
 * Spec section 6. Both queries run at once, and a failure on one side does not hide the other, so
 * during a failover the page can show the writer erroring while the reader still answers.
 *
 * `fresh` replaces the warm reader pool with a connection opened for this request alone. The
 * reader endpoint balances by DNS, so only a new connection can land on another reader, and only
 * once the 5 s TTL of the previous answer has passed.
 */
export async function whoAmI(
  route: Route,
  via: Via,
  fresh: boolean,
  deps: WhoAmIDeps,
): Promise<WhoAmI> {
  const [writer, reader] = await Promise.all([
    introspect(route.writer),
    fresh ? introspectFresh(route) : introspect(route.reader),
  ]);

  return WhoAmISchema.parse({
    at: new Date().toISOString(),
    via,
    fresh,
    app: deps.task,
    writer: withAz(writer, route.hosts.writer, deps.azs),
    reader: withAz(reader, route.hosts.reader, deps.azs),
  });
}

/** Latency here includes the TLS handshake and authentication, which is the point of the button. */
async function introspectFresh(route: Route): Promise<Probe> {
  const started = performance.now();
  const client = new pg.Client({ ...route.base, host: route.hosts.reader });
  // A connection error would otherwise be emitted with no listener and crash the process.
  client.on('error', () => undefined);
  try {
    await client.connect();
    const probe = await introspect(client);
    return { ...probe, latencyMs: elapsedMs(started) };
  } catch (error) {
    return { ok: false, ...describeError(error), latencyMs: elapsedMs(started) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function withAz(probe: Probe, endpoint: string, azs: InstanceAzs) {
  return probe.ok ? { ...probe, endpoint, az: azs.azOf(probe.instance) } : { ...probe, endpoint };
}
