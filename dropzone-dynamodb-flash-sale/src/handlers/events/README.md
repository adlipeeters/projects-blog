# src/handlers/events

EventBridge targets, currently the `notifier`. It consumes `OrderPlaced`, `OrderStatusChanged`
and `CartAbandoned`, and dedupes on the event id `<orderId>#<version>`.
