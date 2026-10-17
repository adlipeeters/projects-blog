# infra/modules/api

One `aws_apigatewayv2_api` (HTTP) in `eu-central-1`, one integration and route per handler, and a
`$default` stage with throttling and JSON access logs.

Auth is a trusted `x-customer-id` header, a deliberate non-goal of this project.
