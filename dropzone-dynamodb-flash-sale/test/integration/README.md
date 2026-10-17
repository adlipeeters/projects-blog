# test/integration

DynamoDB Local in Testcontainers, tables created from `schema/tables.json`. Needs Docker.

One test per access pattern, plus the hard cases:

- 50 parallel checkouts for 10 units in 2 buckets: exactly 10 orders, 0 left, invariant holds.
- The same `Idempotency-Key` twice: one order, the second call replays it.
- Confirm and sweeper racing on the same nearly expired hold, 100 times: exactly one wins.
- A backfill-style update does not make `outbox-publisher` emit an event.

What DynamoDB Local cannot test: TTL deletion, throttling, global table replication. Those live in
`test/e2e`.
