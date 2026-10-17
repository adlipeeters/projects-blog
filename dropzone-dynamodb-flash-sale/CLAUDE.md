# Agent rules for Dropzone

Dropzone is a serverless commerce backend built to survive a flash sale: 500 units of one
product, thousands of buyers in the same minute, zero oversold units. It exists to demonstrate
DynamoDB modelling from access patterns in a public repo and a blog series.

## The spec is the source of truth

`docs/SPEC.md` governs this project. Table names, key formats, index names, access patterns and
milestone scope change by editing the spec first, then the code. If the code and the spec
disagree, the code is wrong.

The spec is deliberately not committed: it holds the article plan and results that are not
published yet, so it is gitignored here and versioned in a private repo. It is still the source
of truth, and it is on disk at `docs/SPEC.md` while this project is being built. If it is not
there, say so instead of guessing a key format or an index name, because the formats in section 6
cannot be reconstructed from the code without losing their reasons.

Nothing enters the schema without an access-pattern number from spec section 4. If a feature
needs a new query shape, add an AP row to the spec before touching keys or indexes.

## Key design

- `src/persistence/keys.ts` is the only place key strings are built. No `PK`/`SK` string
  literals or template strings anywhere else, including tests, scripts and mappers.
- The formats in spec section 6 are exact. Zero-pad numbers in sort keys: prices to 10 digits of
  cents, counts to 10 digits.
- Shard numbers come from one stable hash (FNV-1a of the id, modulo the shard count), never
  random, so a reader can recompute where an item lives. Stock buckets are the one exception:
  the writer picks at random and stores the choice in the order's `allocations`.
- Every diff to `keys.ts` or its snapshot test needs human review. Wrong key formats are the
  most expensive bug in this project.

## schema/tables.json

Single source for table names, key attribute names, index names and shard counts. Terraform
reads it with `jsondecode(file(...))` and the integration tests create DynamoDB Local tables from
it, so infra and tests cannot drift. Never hardcode those names elsewhere; read them from here.

`status-date-index` is deliberately absent. It is added to the live table in milestone 7.

## Layer boundaries

Three layers, each with its own types, joined by explicit mappers (spec section 3).

- `src/domain/` is pure TypeScript. No AWS imports, no `PK`/`SK`, no index attributes.
- `src/persistence/mappers/` owns `toItem` / `fromItem`. Every read from DynamoDB is parsed with
  Zod and throws `CorruptItemError` with the key on failure. Never return a raw item.
- `src/api/schemas/` validates all input and builds responses from domain objects, never from raw
  items.

Money is `{ amountCents: number; currency: 'EUR' }`. Never floats. Timestamps are ISO-8601 UTC
strings, except TTL attributes, which are epoch seconds.

## Queries

No `Scan`, ever, except in `scripts/backfill-status-index.ts` (the one-off migration in spec
section 10). Use `Query`, `GetItem`, `BatchGetItem` or `TransactWriteItems`.

Every stream handler uses the Powertools batch processor, reports partial batch failures, and
makes every side effect idempotent, because stream records are delivered at least once.

## Working order

Build one milestone at a time (spec section 13). A milestone is done when its acceptance criteria
hold and its unit and integration tests pass locally. For every access pattern, write the
integration test first, then the repository method.

## Conventions

- Resource names: `dropzone-{env}-{name}`. One `dev` stage, one AWS account.
- Regions: `eu-central-1` primary, `us-east-1` carts replica only.
- Node 22, arm64 Lambdas, TypeScript strict with `noUncheckedIndexedAccess`.
- pnpm for packages, Terraform for all infrastructure. No CDK, no CloudFormation by hand.
- No ORM for DynamoDB. Key design must stay visible.
