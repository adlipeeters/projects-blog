# src/api/schemas

Zod request and response DTOs: `PlaceOrderRequest`, `OrderResponse` and friends.

All input is validated here. Responses are built from domain objects, never from raw DynamoDB
items. Errors map to `{ code, message }`: 400 validation, 404 not found, 409 sold out or
conflict, 410 hold expired, 422 idempotency mismatch.
