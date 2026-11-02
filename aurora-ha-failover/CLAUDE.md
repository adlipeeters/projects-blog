# Agent rules for Aurora HA Failover

An Aurora PostgreSQL cluster broken on purpose, to measure what a Node.js app sees during an
in-Region failover through three client setups: `naive`, `tuned` and `proxy`.

## The spec is the source of truth

`docs/SPEC.md` governs this project: topology, client mode settings, heartbeat rules, scenarios
and what counts as a result. Change the spec first, then the code.

The spec is gitignored because it holds the unpublished article plan and results. If it is not
on disk, say so instead of guessing a setting, because the client mode settings in section 5 are
what the measurements compare.

## Measurements

- The article states only what a run in spec section 9 measured. Never fill a result from AWS
  documentation or from a single run.
- No retries inside a heartbeat tick. A retry turns an error into latency and hides the gap being
  measured.
- `naive` keeps `pg` defaults on purpose. Do not "fix" it.

## Conventions

- Resource names: `afl-{env}-{name}`. One `dev` stage, `eu-central-1`, AZs `a`, `b`, `c`.
- Node 22 on Fargate arm64, TypeScript strict with `noUncheckedIndexedAccess`, Fastify, `pg`, no
  ORM.
- pnpm for packages, Terraform for all infrastructure, the Makefile as the command surface.
- No CI. Infrastructure is applied from a laptop, and `make check` is the gate.
- The cluster costs money every hour it exists. Never run `terraform apply` or `make deploy`
  without the author asking for it in that moment.
