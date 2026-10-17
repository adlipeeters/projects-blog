# src/handlers/scheduled

EventBridge Scheduler targets. One for now: the reservation sweeper, every minute.

It queries the four `holds-index` shards for `GSI3SK < <now>` and releases each expired hold.
TTL is not the timer: correctness comes from the `expiresAt` conditions, so confirm and release
can never both succeed. TTL only cleans the item up a day later.
