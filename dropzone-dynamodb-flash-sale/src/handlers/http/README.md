# src/handlers/http

One file per route, one Lambda per route, each with an IAM role scoped to the exact actions,
tables and indexes it uses. Routes are listed in spec section 7.

Defaults: 512 MB, arm64, 10 s timeout, Powertools logger, metrics and tracer on every handler.
