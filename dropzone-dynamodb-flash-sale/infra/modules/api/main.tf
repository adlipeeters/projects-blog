# One HTTP API for every route (spec section 7). Auth is a trusted x-customer-id header, which is
# a deliberate non-goal of the project, so no authorizer is wired here.

resource "aws_apigatewayv2_api" "this" {
  name          = var.name_prefix
  protocol_type = "HTTP"
  description   = "Dropzone commerce API"

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name_prefix}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_apigatewayv2_integration" "this" {
  for_each = var.routes

  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = each.value.timeout_ms
}

resource "aws_apigatewayv2_route" "this" {
  for_each = var.routes

  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.this[each.key].id}"
}

# Scoped to this API, so the function cannot be invoked by anything else.
resource "aws_lambda_permission" "this" {
  for_each = var.routes

  statement_id  = "AllowInvokeFrom${replace(replace(replace(each.key, " ", ""), "/", ""), "{", "")}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit    = var.throttling_rate_limit
    throttling_burst_limit   = var.throttling_burst_limit
    detailed_metrics_enabled = true
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn

    # JSON, so the access log is queryable in Logs Insights next to the Powertools logs.
    format = jsonencode({
      requestId         = "$context.requestId"
      requestTime       = "$context.requestTime"
      httpMethod        = "$context.httpMethod"
      routeKey          = "$context.routeKey"
      path              = "$context.path"
      status            = "$context.status"
      responseLatency   = "$context.responseLatency"
      integrationError  = "$context.integrationErrorMessage"
      integrationStatus = "$context.integration.status"
    })
  }

  tags = var.tags
}
