# src/persistence/mappers

`toItem(domain): Item` and `fromItem(raw: unknown): Domain`, one pair per entity.

`fromItem` parses with Zod and throws `CorruptItemError` with the key, so bad or legacy items
surface loudly instead of leaking `undefined` into the domain. Never hand a raw item to a caller.
