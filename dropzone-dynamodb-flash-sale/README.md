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

Infrastructure is applied from a laptop. There is no CI, so the checks below are the gate and run
before a commit.

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration   # DynamoDB Local in Testcontainers, needs Docker
pnpm build              # esbuild bundle per handler
pnpm deploy             # build, then terraform apply
pnpm seed               # 200 products plus one drop, into CATALOG_TABLE
pnpm seed-stock         # stock for one sku, split across its buckets
pnpm stock-report       # a sku's buckets and their sum
pnpm reset-catalog      # clear seeded catalog items (between load runs)
pnpm tf:plan            # terraform plan in infra/envs/dev
```

## Milestones

| #   | Milestone                                                                             | Status  |
| --- | ------------------------------------------------------------------------------------- | ------- |
| M0  | Scaffold: repo layout, `schema/tables.json`, Terraform backend, lambda-fn module, API | done    |
| M1  | Catalog table (provisioned + auto scaling), AP1, AP2, seed script                     | done    |
| M2  | Commerce table with LSI, Streams, TTL, PITR; AP5 to AP11 with plain checkout          | done    |
| M3  | `fulfillment-index` and warehouse queue (AP12)                                        | next    |
| M4  | Streams to `outbox-publisher` to EventBridge; `sales-aggregator` + AP14               | pending |
| M5  | Carts global table, AP3, AP4, `cart-abandonment` in both regions                      | pending |
| M6  | Flash sale: stock buckets, holds, sweeper, load tests A and B                         | pending |
| M7  | Live migration: `status-date-index` + backfill + AP16                                 | pending |
| M8  | Hardening: alarms, dashboard, cost write-up per table                                 | pending |

## Articles

| #   | Article                                        | Milestones | Tag             |
| --- | ---------------------------------------------- | ---------- | --------------- |
| 1   | Designing DynamoDB tables from access patterns | M0 to M3   | `v1-modeling`   |
| 2   | Surviving a flash sale on DynamoDB             | M6         | `v2-flash-sale` |
| 3   | Streams, global tables and changing live data  | M4, M5, M7 | `v3-events`     |
