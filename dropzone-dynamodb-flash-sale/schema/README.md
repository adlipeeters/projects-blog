# schema

`tables.json` is the single source of truth for table names, key attribute names, index names and
shard counts. Terraform reads it with `jsondecode(file(...))` and the integration tests create
DynamoDB Local tables from it, so infrastructure and tests cannot drift.

`status-date-index` is deliberately absent: it is added to the live commerce table in milestone 7,
and its absence is part of the migration story.

Changing anything here starts in `docs/SPEC.md` sections 5 and 6.
