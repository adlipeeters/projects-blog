# src/persistence/repositories

One repository per aggregate. Each method implements a numbered access pattern from spec
section 4 and says so in a comment.

No `Scan`. Write the integration test for the access pattern first, then the method.
