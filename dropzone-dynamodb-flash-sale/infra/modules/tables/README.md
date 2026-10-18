# infra/modules/tables

The three DynamoDB tables, driven by `schema/tables.json`: catalog (provisioned + target-tracking
auto scaling), commerce (on-demand, LSI, three GSIs, streams, TTL, warm and max throughput,
Contributor Insights) and carts (on-demand, streams, TTL).

The carts table exists but has no routes and no replica yet. Adding `us-east-1` to its `replicas`
in `schema/tables.json` is the only change needed to make it a global table, which M5 does along
with the handlers and the per-Region abandonment consumer.

PITR and deletion protection on all three. `replica` requires streams with `NEW_AND_OLD_IMAGES`.
