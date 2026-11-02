import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  DeleteDBInstanceCommand,
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  DescribeEventsCommand,
  FailoverDBClusterCommand,
  RDSClient,
  RebootDBInstanceCommand,
  type SourceType,
} from '@aws-sdk/client-rds';
import { z } from 'zod';
import { MODES, TimelineSchema, VerifySchema, type Timeline } from '../src/shared/samples.js';
import { DumpSchema, SCENARIOS, type Dump, type RdsEvent } from './lib/dump.js';
import { formatRun, summarizeRun } from './lib/summary.js';

// Spec section 7. One scenario run: check the cluster is healthy, break it, wait for it to recover,
// dump everything to results/, print the summary.
//
//   pnpm scenario --scenario s1            numbered run, counts towards the results
//   pnpm scenario --scenario s1 --label dry  rehearsal, excluded from the aggregates

const CLEAN_BEFORE_MS = 30_000;
const CLEAN_AFTER_MS = 60_000;
const MIN_WAIT_MS = 30_000;
const MAX_WAIT_MS = 10 * 60_000;
const POLL_MS = 2000;
const TICKS_PER_SECOND = 10;
// A lane must have most of its ticks in a clean window, not just no errors: a lane that stopped
// ticking has no errors either.
const MIN_TICK_SHARE = 0.9;

const env = z
  .object({
    PAGE_URL: z.string().url(),
    CLUSTER_ID: z.string().min(1),
    AWS_REGION: z.string().default('eu-central-1'),
  })
  .parse(process.env);

const { values: args } = parseArgs({
  options: {
    scenario: { type: 'string' },
    label: { type: 'string' },
  },
});
const scenario = z.enum(SCENARIOS).parse(args.scenario);
const rds = new RDSClient({ region: env.AWS_REGION });

interface Topology {
  clusterStatus: string;
  writer: string | null;
  instances: { id: string; status: string; tier: number }[];
}

async function topology(): Promise<Topology> {
  const [clusters, instances] = await Promise.all([
    rds.send(new DescribeDBClustersCommand({ DBClusterIdentifier: env.CLUSTER_ID })),
    rds.send(
      new DescribeDBInstancesCommand({
        Filters: [{ Name: 'db-cluster-id', Values: [env.CLUSTER_ID] }],
      }),
    ),
  ]);
  const cluster = clusters.DBClusters?.[0];
  return {
    clusterStatus: cluster?.Status ?? 'missing',
    writer:
      cluster?.DBClusterMembers?.find((member) => member.IsClusterWriter)?.DBInstanceIdentifier ??
      null,
    instances: (instances.DBInstances ?? []).map((instance) => ({
      id: instance.DBInstanceIdentifier ?? '?',
      status: instance.DBInstanceStatus ?? '?',
      tier: instance.PromotionTier ?? -1,
    })),
  };
}

const allAvailable = (t: Topology) =>
  t.clusterStatus === 'available' &&
  t.instances.every((instance) => instance.status === 'available');

async function timeline(since: number): Promise<Timeline> {
  const response = await fetch(`${env.PAGE_URL}/prober/timeline?since=${since}`);
  if (!response.ok) throw new Error(`prober timeline: HTTP ${response.status}`);
  return TimelineSchema.parse(await response.json());
}

/** Every mode ticked steadily and every tick was ok over the last `windowMs`. */
async function clean(windowMs: number): Promise<{ ok: boolean; runId: string; why: string }> {
  const now = Date.now();
  const recent = await timeline(now - windowMs);
  const expected = (windowMs / 1000) * TICKS_PER_SECOND * MIN_TICK_SHARE;
  for (const mode of MODES) {
    const own = recent.samples.filter((sample) => sample.mode === mode);
    const bad = own.filter((sample) => sample.outcome !== 'ok').length;
    if (own.length < expected) {
      return { ok: false, runId: recent.runId, why: `${mode}: ${own.length} ticks` };
    }
    if (bad > 0) return { ok: false, runId: recent.runId, why: `${mode}: ${bad} not ok` };
  }
  return { ok: true, runId: recent.runId, why: '' };
}

async function nextLabel(): Promise<string> {
  const files = await readdir('results').catch(() => [] as string[]);
  const numbered = files.filter((file) => new RegExp(`^${scenario}-\\d+-`).test(file));
  return String(numbered.length + 1);
}

async function trigger(target: Topology): Promise<Dump['action']> {
  const writer = target.writer;
  if (!writer) throw new Error('no writer');

  switch (scenario) {
    case 's1':
      await rds.send(new FailoverDBClusterCommand({ DBClusterIdentifier: env.CLUSTER_ID }));
      return { kind: 'failover-db-cluster', target: env.CLUSTER_ID };
    case 's2':
      // Aurora refuses ForceFailover ("use the FailoverDBCluster API"), so S2 is the writer
      // restarting in place: an outage of the writer with no promotion.
      await rds.send(new RebootDBInstanceCommand({ DBInstanceIdentifier: writer }));
      return { kind: 'reboot-db-instance', target: writer };
    case 's3':
      await rds.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: writer }));
      return { kind: 'delete-db-instance', target: writer };
    case 's4': {
      // The tier-1 reader when there is one, so the reboot never touches the first failover
      // candidate. No failover is expected at all.
      const readers = target.instances
        .filter((instance) => instance.id !== writer)
        .sort((a, b) => b.tier - a.tier || a.id.localeCompare(b.id));
      const reader = readers[0];
      if (!reader) throw new Error('no reader to reboot');
      await rds.send(new RebootDBInstanceCommand({ DBInstanceIdentifier: reader.id }));
      return { kind: 'reboot-db-instance', target: reader.id };
    }
  }
}

async function events(since: number): Promise<RdsEvent[]> {
  const read = async (sourceType: SourceType) => {
    const result = await rds.send(
      new DescribeEventsCommand({ SourceType: sourceType, StartTime: new Date(since) }),
    );
    return (result.Events ?? [])
      .filter((event) => event.SourceIdentifier?.startsWith(env.CLUSTER_ID))
      .map((event) => ({
        date: event.Date?.getTime() ?? 0,
        source: event.SourceIdentifier ?? '?',
        message: event.Message ?? '',
      }));
  };
  const [cluster, instances] = await Promise.all([read('db-cluster'), read('db-instance')]);
  return [...cluster, ...instances].sort((a, b) => a.date - b.date);
}

async function verify(since: number): Promise<Dump['verify']> {
  const response = await fetch(`${env.PAGE_URL}/prober/verify?since=${since}`);
  if (!response.ok) {
    console.warn(`lost-writes check failed: HTTP ${response.status}`);
    return null;
  }
  return VerifySchema.parse(await response.json());
}

const log = (message: string) =>
  console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);

// 1. Preflight.
const before = await topology();
if (before.instances.length !== 3 || !allAvailable(before) || !before.writer) {
  throw new Error(
    `cluster not ready: ${before.clusterStatus}, ` +
      before.instances.map((i) => `${i.id} ${i.status}`).join(', ') +
      (before.instances.length !== 3 ? '. After S3, run make restore first.' : ''),
  );
}
const preflight = await clean(CLEAN_BEFORE_MS);
if (!preflight.ok) throw new Error(`prober not clean for 30 s: ${preflight.why}`);
const label = args.label ?? (await nextLabel());
log(`${scenario} run ${label}: writer ${before.writer}, prober run ${preflight.runId.slice(0, 8)}`);

// 2. Break it.
const triggeredAt = Date.now();
const action = await trigger(before);
log(`triggered ${action.kind} ${action.target}`);

// 3. Wait for recovery.
let sawDisruption = false;
let timedOut = true;
let last = before;
while (Date.now() - triggeredAt < MAX_WAIT_MS) {
  await sleep(POLL_MS);
  last = await topology();
  const gone = scenario === 's3' && !last.instances.some((i) => i.id === action.target);
  if (!allAvailable(last) || last.writer !== before.writer || gone) sawDisruption = true;

  if (!sawDisruption || Date.now() - triggeredAt < MIN_WAIT_MS || !allAvailable(last)) continue;
  if (scenario === 's3' && !gone) continue;
  const after = await clean(CLEAN_AFTER_MS);
  if (after.runId !== preflight.runId) {
    throw new Error('the prober restarted during the run, so its samples are gone; run it again');
  }
  if (after.ok) {
    timedOut = false;
    break;
  }
}
const finishedAt = Date.now();
log(timedOut ? 'gave up waiting after 10 minutes' : `recovered, writer ${last.writer}`);

// 4. Dump.
const windowStart = triggeredAt - CLEAN_BEFORE_MS;
const [final, rdsEvents, verified] = await Promise.all([
  timeline(windowStart),
  events(triggeredAt - 120_000),
  verify(windowStart),
]);
const dump = DumpSchema.parse({
  scenario,
  label,
  runId: final.runId,
  action,
  writerBefore: before.writer,
  writerAfter: last.writer,
  triggeredAt,
  finishedAt,
  timedOut,
  samples: final.samples,
  events: rdsEvents,
  verify: verified,
});

await mkdir('results', { recursive: true });
const stamp = new Date(triggeredAt).toISOString().replace(/[-:]/g, '').slice(0, 15);
const file = `results/${scenario}-${label}-${stamp}.json`;
await writeFile(file, JSON.stringify(dump));
log(`wrote ${file}`);

// 5. Summary.
console.log(formatRun(summarizeRun(dump)).join('\n'));
if (scenario === 's3')
  console.log('\nThe deleted instance is gone. Run make restore before the next run.');
