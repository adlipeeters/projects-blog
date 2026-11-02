import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MODES } from '../src/shared/samples.js';
import { DumpSchema, SCENARIOS } from './lib/dump.js';
import { formatRun, summarizeRun, type RunSummary } from './lib/summary.js';

// Every run in results/, one block each, then the table for spec section 9: median and range per
// scenario and mode. Rehearsals (any label that is not a number) are listed but never aggregated,
// and a single run is never reported on its own (spec section 8).
//
//   pnpm summarize                 everything in results/
//   pnpm summarize results/a.json  just these files

const files =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : (await readdir('results').catch(() => [] as string[]))
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map((file) => join('results', file));

if (files.length === 0) {
  console.log('No runs in results/ yet.');
  process.exit(0);
}

const runs: RunSummary[] = [];
for (const file of files) {
  const summary = summarizeRun(DumpSchema.parse(JSON.parse(await readFile(file, 'utf8'))));
  runs.push(summary);
  console.log(formatRun(summary).join('\n'));
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const s = (ms: number) => (ms / 1000).toFixed(1);

const rows: string[] = [];
for (const scenario of SCENARIOS) {
  const counted = runs.filter((run) => run.scenario === scenario && /^\d+$/.test(run.label));
  if (counted.length < 2) continue;
  for (const mode of MODES) {
    const own = counted.flatMap((run) => run.modes.filter((m) => m.mode === mode));
    const downtimes = own.flatMap((m) => (m.downtimeMs === null ? [] : [m.downtimeMs]));
    if (downtimes.length === 0) continue;
    const mix: Record<string, number> = {};
    for (const m of own) {
      for (const [code, count] of Object.entries(m.errorMix)) mix[code] = (mix[code] ?? 0) + count;
    }
    const lost = own.every((m) => m.lost !== null)
      ? String(own.reduce((sum, m) => sum + (m.lost ?? 0), 0))
      : 'not verified';
    const mixText =
      Object.entries(mix)
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => `${code} ${count}`)
        .join(', ') || 'none';
    rows.push(
      `| ${scenario.toUpperCase()} | ${mode} | ${s(median(downtimes))} s ` +
        `(${s(Math.min(...downtimes))} to ${s(Math.max(...downtimes))}), ${counted.length} runs ` +
        `| ${mixText} | ${lost} |`,
    );
  }
}

console.log('');
if (rows.length === 0) {
  console.log('No scenario has two numbered runs yet, so there is no aggregate.');
} else {
  console.log('| Scenario | Mode | Write downtime median (range) | Error mix | Lost writes |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const row of rows) console.log(row);
}
