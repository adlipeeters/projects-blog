import { MODES, type Mode, type Sample } from '../../src/shared/samples.js';
import type { Dump, RdsEvent } from './dump.js';

// Spec section 8: what one run measured, per mode.

export interface ModeSummary {
  mode: Mode;
  samples: number;
  /**
   * The longest stretch with no acknowledged write: the largest gap between two consecutive ok
   * settlements. It covers errors and stalls alike, so a client that hides a failover behind slow
   * but successful writes still shows its downtime. About 100 ms when nothing happened.
   */
  downtimeMs: number | null;
  /** First non-ok tick started to last non-ok tick settled. Null when every tick was ok. */
  errorWindowMs: number | null;
  /** The slowest acknowledged write. */
  maxOkLatencyMs: number | null;
  /** Count per error code, with `deadline` for timeouts and `skipped` for skipped ticks. */
  errorMix: Record<string, number>;
  acknowledged: number | null;
  lost: number | null;
}

export interface AuroraTiming {
  /** Offsets from the trigger, from the RDS events. Null when the event is absent. */
  failoverStartedMs: number | null;
  failoverCompletedMs: number | null;
}

export interface RunSummary {
  scenario: Dump['scenario'];
  label: string;
  action: Dump['action'];
  writerBefore: string;
  writerAfter: string | null;
  timedOut: boolean;
  aurora: AuroraTiming;
  modes: ModeSummary[];
}

export function summarizeMode(mode: Mode, samples: Sample[], verify: Dump['verify']): ModeSummary {
  const own = samples.filter((sample) => sample.mode === mode);
  const ok = own.filter((sample) => sample.outcome === 'ok');
  const notOk = own.filter((sample) => sample.outcome !== 'ok');

  const settlements = ok.map((sample) => sample.settledAt).sort((a, b) => a - b);
  let downtimeMs: number | null = null;
  for (let i = 1; i < settlements.length; i++) {
    const gap = settlements[i]! - settlements[i - 1]!;
    if (downtimeMs === null || gap > downtimeMs) downtimeMs = gap;
  }

  const errorWindowMs =
    notOk.length === 0
      ? null
      : Math.max(...notOk.map((sample) => sample.settledAt)) -
        Math.min(...notOk.map((sample) => sample.startedAt));

  const errorMix: Record<string, number> = {};
  for (const sample of notOk) {
    const code =
      sample.outcome === 'error' ? (sample.code ?? 'unknown') : (sample.code ?? sample.outcome);
    errorMix[code] = (errorMix[code] ?? 0) + 1;
  }

  const verified = verify?.lanes.find((lane) => lane.mode === mode);

  return {
    mode,
    samples: own.length,
    downtimeMs,
    errorWindowMs,
    maxOkLatencyMs:
      ok.length === 0 ? null : Math.max(...ok.map((sample) => sample.settledAt - sample.startedAt)),
    errorMix,
    acknowledged: verified?.acknowledged ?? null,
    lost: verified ? verified.missing.length : null,
  };
}

/**
 * Aurora reports a failover as "Started cross AZ failover to DB instance: …" and, for one started
 * by the API, "Completed customer initiated failover to DB instance: …" on the cluster. When
 * Aurora gives the writer role back to the instance that just lost it, the start is logged as
 * "Promoting previous primary again: …" instead. The first start and the last completion
 * after the trigger bound Aurora's own share of the downtime.
 */
export function auroraTiming(events: RdsEvent[], triggeredAt: number): AuroraTiming {
  const after = events
    .filter((event) => event.date >= triggeredAt - 1000)
    .sort((a, b) => a.date - b.date);
  const started = after.find((event) =>
    /started .*failover|promoting previous primary/i.test(event.message),
  );
  const completed = after.findLast((event) => /completed .*failover/i.test(event.message));
  return {
    failoverStartedMs: started ? started.date - triggeredAt : null,
    failoverCompletedMs: completed ? completed.date - triggeredAt : null,
  };
}

export function summarizeRun(dump: Dump): RunSummary {
  const modes = MODES.filter((mode) => dump.samples.some((sample) => sample.mode === mode));
  return {
    scenario: dump.scenario,
    label: dump.label,
    action: dump.action,
    writerBefore: dump.writerBefore,
    writerAfter: dump.writerAfter,
    timedOut: dump.timedOut,
    aurora: auroraTiming(dump.events, dump.triggeredAt),
    modes: modes.map((mode) => summarizeMode(mode, dump.samples, dump.verify)),
  };
}

const seconds = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`);

/** One line per mode, plus a header line for the run. */
export function formatRun(summary: RunSummary): string[] {
  const { aurora } = summary;
  const header =
    `${summary.scenario.toUpperCase()} ${summary.label}: ${summary.action.kind} ${summary.action.target}, ` +
    `writer ${summary.writerBefore} -> ${summary.writerAfter ?? '?'}, ` +
    `aurora failover ${seconds(aurora.failoverStartedMs)} to ${seconds(aurora.failoverCompletedMs)} after trigger` +
    (summary.timedOut ? ', TIMED OUT' : '');

  const lines = summary.modes.map((mode) => {
    const mix = Object.entries(mode.errorMix)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => `${code} x${count}`)
      .join(' ');
    const lost = mode.lost === null ? 'not verified' : `${mode.lost} of ${mode.acknowledged}`;
    return (
      `  ${mode.mode.padEnd(6)} downtime ${seconds(mode.downtimeMs).padStart(7)}` +
      `  error window ${seconds(mode.errorWindowMs).padStart(7)}` +
      `  slowest ok ${seconds(mode.maxOkLatencyMs).padStart(7)}` +
      `  lost ${lost}` +
      `  ${mix || 'no errors'}`
    );
  });

  return [header, ...lines];
}
