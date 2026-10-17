# src/handlers/streams

DynamoDB Streams consumers: `outbox-publisher`, `sales-aggregator`, `cart-abandonment`.

The commerce stream has exactly two Lambda readers and the carts stream one per region, the most
AWS recommends per shard. All further fan-out goes through EventBridge.

Rules for every handler: Powertools batch processor with partial batch failures reported;
unmarshall images, then parse them with the same Zod mappers the API uses; ordering is guaranteed
per item only; every side effect is idempotent, because records arrive at least once.
