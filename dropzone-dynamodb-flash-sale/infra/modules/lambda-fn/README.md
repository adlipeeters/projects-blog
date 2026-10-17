# infra/modules/lambda-fn

Reusable function module: `aws_lambda_function` (arm64, Node.js 22, zip from the esbuild output),
a CloudWatch log group with 14-day retention, an IAM role whose inline least-privilege policy is
passed in by the caller, and X-Ray active tracing.

Defaults: 512 MB, 10 s timeout. Each function's policy names the exact actions, tables and
indexes it uses, nothing wider.
