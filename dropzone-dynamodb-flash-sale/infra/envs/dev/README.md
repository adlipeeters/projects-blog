# infra/envs/dev

The one environment: backend configuration, providers and module wiring. Default provider in
`eu-central-1`, plus an aliased `us-east-1` provider for the carts replica region's Lambda and
bus.

Outputs: API URL, table names, stream ARNs, bus names. Run `fmt -check`, `validate` and `plan`
locally before every apply.
