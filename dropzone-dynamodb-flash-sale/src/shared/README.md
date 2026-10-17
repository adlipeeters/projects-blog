# src/shared

Cross-cutting helpers: Powertools logger and metrics setup, error types, ULID generation, money
arithmetic.

Logs carry `requestId`, `customerId` and `orderId` or `holdId` on every line, and never emails or
names. Custom metrics go in the `Dropzone` namespace: `OrdersPlaced`, `CheckoutSoldOut`,
`TxConflictRetries`, `IdempotentReplays`, `HoldsReleasedBySweeper`, `HoldExpiredUnreleased`.
