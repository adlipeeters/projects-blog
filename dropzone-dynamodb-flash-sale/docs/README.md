# docs

The build spec for this project lives at `docs/SPEC.md` and is not committed.

It is the source of truth for the design: sixteen access patterns, the three-table split, every
key format, the index definitions, the flash-sale experiment and the live migration plan. It also
contains the plan for the articles it backs, including results that have not been measured or
published yet, which is why it stays private for now. It is versioned in a private repo.

What the spec decides is still visible here, in the places that have to agree with it:

- `schema/tables.json`: table, key and index names, and shard counts.
- `src/persistence/keys.ts`: every key format, with its access-pattern number.
- `CLAUDE.md`: the rules that keep code and spec from drifting.
- the README in each directory: what belongs there and why.

The spec will be committed here once the article series is published.
