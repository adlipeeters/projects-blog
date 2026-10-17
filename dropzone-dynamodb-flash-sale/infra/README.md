# infra

All infrastructure, in Terraform ≥ 1.10 with AWS provider 6.x. No CDK, no console changes.
State lives in S3 with native lockfile locking (`use_lockfile`).

Applies are run from a laptop. There is no CI and no CI role.

`envs/dev` is the only environment and wires five modules: `tables`, `lambda-fn`, `api`, `events`,
`alarms`. Table, key and index names come from `../schema/tables.json` via
`jsondecode(file(...))`, never from literals here.

Gotchas that the spec (section 12) requires respecting:

- An LSI can only be defined when the table is created. All three tables carry
  `lifecycle { prevent_destroy = true }` on top of deletion protection.
- Create or delete one GSI per apply.
- On the catalog table, `lifecycle { ignore_changes }` must cover table and GSI read/write
  capacity, or Terraform fights auto scaling on every apply.
- `warm_throughput` can only go up. Keep the values in a variable and document every increase.
