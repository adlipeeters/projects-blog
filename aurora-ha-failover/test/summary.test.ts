import { describe, expect, it } from 'vitest';
import type { Mode, Sample } from '../src/shared/samples.js';
import { auroraTiming, summarizeMode } from '../scripts/lib/summary.js';

const T0 = 1_000_000;

/** Ticks every 100 ms from T0, each settling `latency` ms after it started. */
function ticks(
  mode: Mode,
  count: number,
  shape: (seq: number) => Partial<Sample> = () => ({}),
): Sample[] {
  return Array.from({ length: count }, (_, i) => {
    const startedAt = T0 + i * 100;
    return {
      mode,
      seq: i + 1,
      startedAt,
      settledAt: startedAt + 3,
      outcome: 'ok',
      code: null,
      message: null,
      writerInstance: 'afl-dev-1',
      ...shape(i + 1),
    };
  });
}

describe('summarizeMode', () => {
  it('reports one tick interval of downtime and no errors on a quiet run', () => {
    const summary = summarizeMode('tuned', ticks('tuned', 50), null);

    expect(summary.downtimeMs).toBe(100);
    expect(summary.errorWindowMs).toBeNull();
    expect(summary.errorMix).toEqual({});
    expect(summary.lost).toBeNull();
  });

  it('measures downtime from the last ok settlement before the errors to the first after', () => {
    // Ticks 11 to 40 fail: 3 s of errors.
    const samples = ticks('naive', 60, (seq) =>
      seq > 10 && seq <= 40 ? { outcome: 'error', code: '25006', writerInstance: null } : {},
    );

    const summary = summarizeMode('naive', samples, null);

    // Last ok settles at tick 10 (T0 + 903), next at tick 41 (T0 + 4003).
    expect(summary.downtimeMs).toBe(3100);
    expect(summary.errorWindowMs).toBe(39 * 100 + 3 - 10 * 100);
    expect(summary.errorMix).toEqual({ '25006': 30 });
  });

  it('counts a stall without errors as downtime', () => {
    // Ticks 11 to 30 all succeed, but only once the stall ends at T0 + 5000. Nothing else settles
    // in between.
    const samples = ticks('proxy', 30, (seq) =>
      seq > 10 && seq <= 30 ? { settledAt: T0 + 5000 + seq } : {},
    );

    const summary = summarizeMode('proxy', samples, null);

    expect(summary.errorWindowMs).toBeNull();
    expect(summary.downtimeMs).toBe(T0 + 5011 - (T0 + 903));
    expect(summary.maxOkLatencyMs).toBe(T0 + 5011 - (T0 + 1000));
  });

  it('names timeouts and skipped ticks in the error mix', () => {
    const samples = ticks('naive', 20, (seq) => {
      if (seq === 5) return { outcome: 'timeout', code: 'deadline', writerInstance: null };
      if (seq === 6) return { outcome: 'skipped', code: null, writerInstance: null };
      return {};
    });

    expect(summarizeMode('naive', samples, null).errorMix).toEqual({ deadline: 1, skipped: 1 });
  });

  it('takes lost writes from the verify result of its own mode', () => {
    const verify = {
      runId: 'r',
      lanes: [
        { mode: 'naive' as const, acknowledged: 20, missing: [7] },
        { mode: 'tuned' as const, acknowledged: 20, missing: [] },
      ],
    };

    expect(summarizeMode('naive', ticks('naive', 20), verify)).toMatchObject({
      acknowledged: 20,
      lost: 1,
    });
    expect(summarizeMode('tuned', ticks('tuned', 20), verify).lost).toBe(0);
  });
});

describe('auroraTiming', () => {
  it('takes the first failover start and the last completion after the trigger', () => {
    const events = [
      { date: T0 - 60_000, source: 'afl-dev', message: 'Completed failover to DB instance: old' },
      {
        date: T0 + 2_000,
        source: 'afl-dev',
        message: 'Started cross AZ failover to DB instance: afl-dev-2',
      },
      {
        date: T0 + 31_000,
        source: 'afl-dev',
        message: 'Completed customer initiated failover to DB instance: afl-dev-2',
      },
    ];

    expect(auroraTiming(events, T0)).toEqual({
      failoverStartedMs: 2_000,
      failoverCompletedMs: 31_000,
    });
  });

  it('reports nulls when there was no failover, as when a reader reboots', () => {
    const events = [{ date: T0 + 1_000, source: 'afl-dev-3', message: 'DB instance restarted' }];

    expect(auroraTiming(events, T0)).toEqual({
      failoverStartedMs: null,
      failoverCompletedMs: null,
    });
  });
});

describe('auroraTiming, when the old writer gets the role back', () => {
  it('counts "Promoting previous primary again" as the start', () => {
    const events = [
      {
        date: T0 + 10_400,
        source: 'afl-dev',
        message: 'Promoting previous primary again: afl-dev-1',
      },
      {
        date: T0 + 18_000,
        source: 'afl-dev',
        message: 'Completed customer initiated failover to DB instance: afl-dev-1',
      },
    ];

    expect(auroraTiming(events, T0)).toEqual({
      failoverStartedMs: 10_400,
      failoverCompletedMs: 18_000,
    });
  });
});
