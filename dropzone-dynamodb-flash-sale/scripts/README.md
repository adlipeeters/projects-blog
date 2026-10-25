# scripts

Operational scripts, run with `tsx`.

- `seed.ts`: catalog and stock seed. Splits a drop's stock evenly across buckets (500 units into
  10 items of 50).
- `seed-stock.ts`: stock for one sku. `--buckets` does both halves of the job: it splits the units
  across that many stock items, and it sets the variant's `stockBuckets`, which is what checkout
  and create-hold actually rotate over. Run A and run B differ in this flag alone.
- `verify-stock.ts`: the invariant checked after every load run. Sum of `available` + units in
  orders + units in HELD holds must equal the initial stock. Any difference fails the run, and the
  script exits non-zero so a harness can gate on it. Flags: `--sku`, `--units`, `--since`, `--json`.
  Pass `--since` with the timestamp `seed-stock` printed: seeding overwrites `available` rather than
  adding to it, so orders from before the seed are already outside the sum and counting them would
  report a surplus. Units in cancelled orders and in confirmed or released holds are reported
  separately and excluded, because they are already back inside `available`.
- `backfill-status-index.ts`: the section 10 migration. Flags: `--job-id`, `--dry-run`,
  `--segments`, `--max-wcu`. Running it twice is safe.
- `stock-report.ts`: a sku's buckets and their sum. The bucket count comes from the variant, so
  the report cannot disagree with what the allocator rotates over.
- `rebalance-stock.ts` (optional): moves units between buckets in a transaction.
- `build.mjs`: esbuild, one bundle per handler.

`verify-stock.ts` and `backfill-status-index.ts` are the only two places a `Scan` is allowed, and
neither is an access pattern: nothing indexes orders by sku, on purpose, since an index every order
in a drop would write is the hot partition this project exists to avoid.
