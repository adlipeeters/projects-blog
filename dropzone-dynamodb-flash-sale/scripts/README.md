# scripts

Operational scripts, run with `tsx`.

- `seed.ts`: catalog and stock seed. Splits a drop's stock evenly across buckets (500 units into
  10 items of 50).
- `verify-stock.ts`: the invariant checked after every load run. Sum of `available` + units in
  orders + units in HELD holds must equal the initial stock. Any difference fails the run.
- `backfill-status-index.ts`: the section 10 migration. The only place a `Scan` is allowed.
  Flags: `--job-id`, `--dry-run`, `--segments`, `--max-wcu`. Running it twice is safe.
- `rebalance-stock.ts` (optional): moves units between buckets in a transaction.
- `build.mjs`: esbuild, one bundle per handler.
