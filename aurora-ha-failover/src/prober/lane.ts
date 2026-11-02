import type pg from 'pg';
import { describeError } from '../shared/introspect.js';
import type { Mode, Sample } from '../shared/samples.js';

// Spec section 5. The rules that keep the three modes comparable.
const TICK_MS = 100;
const DEADLINE_MS = 5000;
const MAX_IN_FLIGHT = 50;
const WINDOW_MS = 30 * 60_000;

// The writer's identity is taken inside the INSERT, on whichever instance accepted it. Aurora
// refuses the function as a column default ("cannot depend on a virtual function").
const INSERT_SQL = `
  insert into heartbeat (run_id, mode, seq, sent_at, writer_instance)
  values ($1, $2, $3, $4, aurora_db_instance_identifier())
  returning writer_instance`;

export interface LaneOptions {
  mode: Mode;
  runId: string;
  createPool: () => pg.Pool;
  /** Error codes after which every socket in the pool is suspect, so the pool is replaced. */
  replacePoolOn: ReadonlySet<string>;
  onSample: (sample: Sample) => void;
}

/**
 * One mode's heartbeat: an INSERT every 100 ms, one sample per tick, no retries.
 *
 * A failed `pool.query` already discards the client it used: pg-pool releases it with the error,
 * which destroys it. That covers the spec's "destroy the client on connection errors" for every
 * mode. What `tuned` and `proxy` add is replacing the whole pool on `25006`, because then every
 * idle socket in it still points at the demoted writer.
 */
export class Lane {
  private pool: pg.Pool;
  private seq = 0;
  private inFlight = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly samples: Sample[] = [];

  constructor(private readonly options: LaneOptions) {
    this.pool = options.createPool();
  }

  get mode(): Mode {
    return this.options.mode;
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.pool.end().catch(() => undefined);
  }

  /** Samples settled after `since`, oldest first. Settlement order is recording order. */
  since(since: number): Sample[] {
    return this.samples.filter((sample) => sample.settledAt > since);
  }

  health() {
    const last = this.samples.at(-1);
    return { mode: this.mode, seq: this.seq, inFlight: this.inFlight, last: last ?? null };
  }

  private tick(): void {
    const seq = ++this.seq;
    const startedAt = Date.now();
    const base = { mode: this.mode, seq, startedAt };

    if (this.inFlight >= MAX_IN_FLIGHT) {
      this.record({
        ...base,
        settledAt: startedAt,
        outcome: 'skipped',
        code: null,
        message: null,
        writerInstance: null,
      });
      return;
    }

    // The deadline only decides how the tick is recorded. It does not cancel the query, so the
    // mode's own timeouts (or lack of them) still decide when the query really ends, and it keeps
    // counting as in flight until then.
    let recorded = false;
    const deadline = setTimeout(() => {
      recorded = true;
      this.record({
        ...base,
        settledAt: Date.now(),
        outcome: 'timeout',
        code: 'deadline',
        message: null,
        writerInstance: null,
      });
    }, DEADLINE_MS);

    const pool = this.pool;
    this.inFlight++;
    pool
      .query<{ writer_instance: string }>(INSERT_SQL, [
        this.options.runId,
        this.mode,
        seq,
        new Date(startedAt),
      ])
      .then(
        (result) => {
          if (recorded) return;
          this.record({
            ...base,
            settledAt: Date.now(),
            outcome: 'ok',
            code: null,
            message: null,
            writerInstance: result.rows[0]?.writer_instance ?? null,
          });
        },
        (error: unknown) => {
          const { code, message } = describeError(error);
          if (this.options.replacePoolOn.has(code)) this.replacePool(pool);
          if (recorded) return;
          this.record({
            ...base,
            settledAt: Date.now(),
            outcome: 'error',
            code,
            message,
            writerInstance: null,
          });
        },
      )
      .finally(() => {
        clearTimeout(deadline);
        this.inFlight--;
      });
  }

  private replacePool(failed: pg.Pool): void {
    // Several in-flight ticks fail together. Only the first replaces the pool.
    if (this.pool !== failed) return;
    this.pool = this.options.createPool();
    void failed.end().catch(() => undefined);
  }

  private record(sample: Sample): void {
    this.samples.push(sample);
    const cutoff = sample.settledAt - WINDOW_MS;
    while (this.samples.length > 0 && this.samples[0]!.settledAt < cutoff) this.samples.shift();
    this.options.onSample(sample);
  }
}
