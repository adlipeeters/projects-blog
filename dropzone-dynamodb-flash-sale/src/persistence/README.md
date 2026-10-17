# src/persistence

The DynamoDB layer. `keys.ts` is the only place key strings are built; everything else reads
them from there.

Every item carries `entityType`, `schemaVersion` and `version` (the optimistic lock counter).
Numbers in sort keys are zero-padded to 10 digits. Timestamps are ISO-8601 UTC strings, except
TTL attributes, which are epoch seconds because DynamoDB requires a Number.

Pagination cursors are the `LastEvaluatedKey`, JSON-encoded then base64url-encoded, and validated
on the way back in.
