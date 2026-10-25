# Dropzone

A serverless commerce backend built to survive a flash sale: 500 units of one product, thousands
of buyers in the same minute, zero oversold units.

It is a teaching project. Every DynamoDB feature in it has a reason to exist: composite keys, an
LSI, sparse and write-sharded GSIs, Streams, TTL, a global table, on-demand and provisioned
capacity, transactions. Sixteen access patterns drive every key and index, and nothing is added
to the schema without an access-pattern number.

The full build spec is private until the articles are published; [docs/README.md](docs/README.md)
explains what it covers. Agent and contributor rules: [CLAUDE.md](CLAUDE.md).

## Stack

TypeScript on Node.js 22 arm64 Lambdas, DynamoDB via AWS SDK v3 `DynamoDBDocumentClient`, Zod at
every boundary, Powertools for logging, metrics and tracing, API Gateway HTTP API, EventBridge
for fan-out, Terraform for all infrastructure. Primary region `eu-central-1`, carts replica
`us-east-1`.

## Layout

```
docs/               the build spec, kept private for now
schema/tables.json  table, key and index names, read by both Terraform and the tests
infra/              Terraform: envs/dev plus five modules
src/domain/         pure types and rules, no AWS imports
src/persistence/    keys.ts, mappers, repositories
src/api/schemas/    Zod request and response DTOs
src/handlers/       http, streams, events, scheduled
src/shared/         logger, metrics, errors, ulid, money
scripts/            seed, backfill, stock verification
test/               unit, integration, e2e, load
```

## Commands

`make` on its own lists everything, grouped. Each target is a thin wrapper over the `pnpm` script
or AWS command underneath, and reads the table names out of `terraform output` so none of them has
to be typed.

Infrastructure is applied from a laptop. There is no CI, so `make check` is the gate and runs
before a commit.

```bash
make                    # the list
make check              # types, lint, format, unit tests, terraform validate
make test               # both test suites (integration needs Docker)
make deploy             # build, then terraform apply
make seed               # 200 products plus one drop
```

The flash sale (spec section 9) is five targets. `make seed-a` and `make seed-b` are the only
difference between the two runs, and each records its cutoff so `make verify` needs no arguments:

```bash
make push               # build the arm64 harness image and push it to ECR
make run-a              # seed one bucket, then start the Fargate run
make result             # the run's summary line
make verify             # available + in orders + in HELD holds == seeded
make run-b              # the same 5,000 units across ten buckets
```

## Milestones

| #   | Milestone                                                                             | Status      |
| --- | ------------------------------------------------------------------------------------- | ----------- |
| M0  | Scaffold: repo layout, `schema/tables.json`, Terraform backend, lambda-fn module, API | done        |
| M1  | Catalog table (provisioned + auto scaling), AP1, AP2, seed script                     | done        |
| M2  | Commerce table with LSI, Streams, TTL, PITR; AP5 to AP11 with plain checkout          | done        |
| M3  | `fulfillment-index` and warehouse queue (AP12)                                        | done        |
| M4  | Streams to `outbox-publisher` to EventBridge; `sales-aggregator` + AP14               | pending     |
| M5  | Carts global table, AP3, AP4, `cart-abandonment` in both regions                      | pending     |
| M6  | Flash sale: stock buckets, holds, sweeper, load runs A and B                          | in progress |
| M7  | Live migration: `status-date-index` + backfill + AP16                                 | pending     |
| M8  | Hardening: alarms, dashboard, cost write-up per table                                 | pending     |

## Articles

| #   | Article                                        | Milestones | Tag             |
| --- | ---------------------------------------------- | ---------- | --------------- |
| 1   | Designing DynamoDB tables from access patterns | M0 to M3   | `v1-modeling`   |
| 2   | Surviving a flash sale on DynamoDB             | M6         | `v2-flash-sale` |
| 3   | Streams, global tables and changing live data  | M4, M5, M7 | `v3-events`     |
