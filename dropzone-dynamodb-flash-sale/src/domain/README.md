# src/domain

Pure TypeScript: `Order`, `OrderLine`, `Product`, `Variant`, `Cart`, `Hold`, `StockBucket`,
`Money` and branded ids. Business rules live here.

No AWS imports, no `PK`/`SK`, no index attributes, no knowledge of DynamoDB at all. ESLint
enforces this.

Conventions: branded ids (`type OrderId = string & { readonly __brand: 'OrderId' }`), ULIDs for
order, hold and customer ids so they sort by creation time, `Money` in integer cents, and a pure
`transition(order, to)` that throws `InvalidTransitionError` on anything outside
PLACED → PICKING → SHIPPED → DELIVERED and PLACED or PICKING → CANCELLED.
