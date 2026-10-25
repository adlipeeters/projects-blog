# test/load

The headline experiment from spec section 9: one SKU sold out twice over, once with the stock in a
single item and once split across ten buckets.

The measured drop is 5,000 units rather than the 500 of the product scenario. One bucket tops out
near 125 checkouts per second, so 500 units would sell out in four seconds and run B in under one,
which is too short to compute a p99 from. 5,000 gives run A about forty seconds and run B about
four. `scripts/seed-stock.ts --units 5000` handles it.

The harness runs as an arm64 Fargate task in `eu-central-1` and drives the repositories in-process
against the deployed commerce table. API Gateway and Lambda are not in the path: the account's
Lambda concurrency quota is 10, and this test is about the data model, so the client is a container
rather than the API.

- `worker.ts` calls `createHold` then `confirmHold` through `holdRepository()`, the same functions
  the `create-hold` and `confirm-hold` handlers call. Nothing is reimplemented here.
- `drop.ts` is the driver: a fixed in-flight count and three stop conditions (sold out, deadline,
  attempt cap). It prints one `RESULT {json}` line with the counts, percentiles, time to sold out
  and which bucket served each confirmed purchase. `--out <path>` also writes every attempt.
- `Dockerfile` bundles it with esbuild into a single file on `node:22-slim`, for arm64.
  `infra/modules/loadtest` holds the ECR repository, cluster and task definition, and its README
  has the four commands a run takes.

Flags: `--sku`, `--qty`, `--concurrency`, `--duration`, `--max-attempts`, `--label`, `--out`.

`make run-a` and `make run-b` are the whole run: they seed, start the task, and leave the cutoff
where `make verify` can find it. `make load-local` runs the harness from your machine, which is
useful for checking the harness itself and useless for latency numbers, since the p50 would be
mostly your connection to the Region.

Set the SDK's `maxSockets` to at least the in-flight count, or the run measures the socket pool
instead of the partition. Start at 400 in-flight: one partition takes 1,000 write units per second
and a four-item transaction costs 8, so about 125 checkouts per second already saturates one bucket,
and run B has ten of them.

Run A uses `stockBuckets = 1`, run B uses `stockBuckets = 10`, same seed, same image, same task
size. Raise the commerce table's warm throughput before both so the comparison isolates the hot key
rather than cold capacity.

Record the results table from spec section 9, take the latency and throttle numbers from CloudWatch
rather than from the client, and run `scripts/verify-stock.ts` afterwards. Finish with one smoke
pass through the deployed API at 5 concurrent checkouts to confirm the real path agrees.
