import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import pg from 'pg';
import { connectionBase, hostsFor, loadCredentials, type Via } from '../shared/db.js';
import { loadEnv } from '../shared/env.js';
import { InstanceAzs, loadTaskIdentity } from '../shared/topology.js';
import { whoAmI, WhoAmIQuerySchema, type Route } from './whoami.js';

const env = loadEnv();
const app = Fastify({ logger: true });

const [credentials, task] = await Promise.all([loadCredentials(env), loadTaskIdentity()]);
const azs = new InstanceAzs(env.AWS_REGION, env.CLUSTER_ID, (error) =>
  app.log.warn({ err: error }, 'instance AZ refresh failed'),
);
await azs.start();

// The page is about showing which instance answered, not about surviving a failover, so the web
// pools only need to not hang. Idle connections are never closed: a warm pool that keeps its
// reader connection is what makes the fresh-connection button worth having (spec section 6).
function pool(base: pg.ClientConfig, host: string, name: string): pg.Pool {
  const created = new pg.Pool({
    ...base,
    host,
    max: 4,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 2000,
    query_timeout: 3000,
    keepAlive: true,
  });
  // An idle client's socket dying during a failover is emitted here. Without a listener it
  // crashes the process.
  created.on('error', (error) => app.log.warn({ err: error, pool: name }, 'idle client error'));
  return created;
}

const routes = new Map<Via, Route>();
for (const via of ['direct', 'proxy'] as const) {
  const hosts = hostsFor(env, via);
  if (!hosts) continue;
  const base = connectionBase(env, credentials, via);
  routes.set(via, {
    hosts,
    base,
    writer: pool(base, hosts.writer, `${via}-writer`),
    reader: pool(base, hosts.reader, `${via}-reader`),
  });
}

const publicDir = join(process.cwd(), 'public');
const [indexHtml, appJs] = await Promise.all([
  readFile(join(publicDir, 'index.html'), 'utf8'),
  readFile(join(publicDir, 'app.js'), 'utf8'),
]);

app.get('/', (_request, reply) => reply.type('text/html; charset=utf-8').send(indexHtml));
app.get('/app.js', (_request, reply) => reply.type('text/javascript; charset=utf-8').send(appJs));

// The ALB health check. It must not touch the database: a check that fails during a failover
// would have the ALB drain both tasks exactly when the page is most interesting.
app.get('/health', () => ({ ok: true }));

app.get('/api/config', () => ({ vias: [...routes.keys()] }));

app.get('/api/whoami', async (request, reply) => {
  const query = WhoAmIQuerySchema.parse(request.query);
  const route = routes.get(query.via);
  if (!route) {
    return reply.code(409).send({ error: `${query.via} is not configured yet` });
  }
  return whoAmI(route, query.via, query.fresh === '1', { task, azs });
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  azs.stop();
  await app.close();
  await Promise.all(
    [...routes.values()].flatMap((route) => [route.writer.end(), route.reader.end()]),
  );
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: env.PORT });
