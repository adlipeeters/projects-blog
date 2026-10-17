# infra/modules/tables

The three DynamoDB tables, driven by `schema/tables.json`: catalog (provisioned + target-tracking
auto scaling), commerce (on-demand, LSI, three GSIs, streams, TTL, warm and max throughput,
Contributor Insights) and carts (on-demand, streams, TTL, `us-east-1` replica).

PITR and deletion protection on all three. `replica` requires streams with `NEW_AND_OLD_IMAGES`.
