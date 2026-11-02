import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import { connectionBase, hostsFor, loadCredentials } from '../shared/db.js';
import { loadEnv } from '../shared/env.js';
import { TimelineSchema, VerifySchema, type Mode, type Sample } from '../shared/samples.js';
import { Lane } from './lane.js';

const env = loadEnv();
const app = Fastify({ logger: true });
const runId = randomUUID();
const startedAt = Date.now();

const credentials = await loadCredentials(env);
const direct = connectionBase(env, credentials, 'direct');

// Spec section 5. `naive` is pg.Pool with nothing set: no connect timeout, no query timeout.
// The error listener is not a setting, it only stops an idle socket's death from crashing the
// process, which would end the measurement for all three modes.
const TUNED: pg.PoolConfig = {
  connectionTimeoutMillis: 1000,
  query_timeout: 2000,
  keepAlive: true,
  idleTimeoutMillis: 10_000,
};
const REPLACE_ON_READ_ONLY = new Set(['25006']);

function makePool(config: pg.PoolConfig, mode: Mode): () => pg.Pool {
  return () => {
    const pool = new pg.Pool(config);
    pool.on('error', (error) => app.log.warn({ err: error, mode }, 'idle client error'));
    return pool;
  };
}

const lanes: Lane[] = [];
const onSample = (sample: Sample) => {
  if (sample.outcome !== 'ok') app.log.info({ sample }, 'heartbeat not ok');
};

lanes.push(
  new Lane({
    mode: 'naive',
    runId,
    createPool: makePool({ ...direct, host: env.WRITER_HOST }, 'naive'),
    replacePoolOn: new Set(),
    onSample,
  }),
  new Lane({
    mode: 'tuned',
    runId,
    createPool: makePool({ ...direct, ...TUNED, host: env.WRITER_HOST }, 'tuned'),
    replacePoolOn: REPLACE_ON_READ_ONLY,
    onSample,
  }),
);

const proxyHosts = hostsFor(env, 'proxy');
if (proxyHosts) {
  const viaProxy = connectionBase(env, credentials, 'proxy');
  lanes.push(
    new Lane({
      mode: 'proxy',
      runId,
      createPool: makePool({ ...viaProxy, ...TUNED, host: proxyHosts.writer }, 'proxy'),
      replacePoolOn: REPLACE_ON_READ_ONLY,
      onSample,
    }),
  );
} else {
  app.log.warn('no proxy configured; running naive and tuned only');
}

// Spec section 4. Created here so the table exists before the first tick. If the writer is not
// reachable the task fails and ECS starts another, which is the right outcome at boot.
const setup = new pg.Client({ ...direct, host: env.WRITER_HOST, connectionTimeoutMillis: 5000 });
await setup.connect();
await setup.query(`
  create table if not exists heartbeat (
    run_id           uuid        not null,
    mode             text        not null,
    seq              bigint      not null,
    sent_at          timestamptz not null,
    writer_instance  text        not null,
    primary key (run_id, mode, seq)
  )`);
await setup.end();

const TimelineQuerySchema = z.object({ since: z.coerce.number().default(0) });

// These two answer from memory, never from the database, so the ALB keeps the prober in service
// through a failover.
app.get('/prober/health', () => ({
  runId,
  startedAt,
  lanes: lanes.map((lane) => lane.health()),
}));

app.get('/prober/timeline', (request) => {
  const { since } = TimelineQuerySchema.parse(request.query);
  return TimelineSchema.parse({
    runId,
    now: Date.now(),
    samples: lanes.flatMap((lane) => lane.since(since)).sort((a, b) => a.settledAt - b.settledAt),
  });
});

// The RPO check: every tick the client saw acknowledged must be in the table. It reads from the
// writer on a connection opened for the request, so no socket left over from before a failover is
// involved. Unlike the two routes above it needs the database, and runs only once a scenario has
// recovered.
app.get('/prober/verify', async (request) => {
  const { since } = TimelineQuerySchema.parse(request.query);
  const client = new pg.Client({ ...direct, host: env.WRITER_HOST, connectionTimeoutMillis: 5000 });
  client.on('error', () => undefined);
  await client.connect();
  try {
    const results = [];
    for (const lane of lanes) {
      const acknowledged = lane
        .since(since)
        .filter((sample) => sample.outcome === 'ok')
        .map((sample) => sample.seq);
      const { rows } = await client.query<{ seq: string }>(
        'select seq from heartbeat where run_id = $1 and mode = $2 and seq = any($3::bigint[])',
        [runId, lane.mode, acknowledged],
      );
      const found = new Set(rows.map((row) => Number(row.seq)));
      results.push({
        mode: lane.mode,
        acknowledged: acknowledged.length,
        missing: acknowledged.filter((seq) => !found.has(seq)),
      });
    }
    return VerifySchema.parse({ runId, lanes: results });
  } finally {
    await client.end().catch(() => undefined);
  }
});

for (const lane of lanes) lane.start();
app.log.info({ runId, modes: lanes.map((lane) => lane.mode) }, 'heartbeat started');

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await Promise.all(lanes.map((lane) => lane.stop()));
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
