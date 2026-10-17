output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  description = "Base URL of the $default stage."
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "execution_arn" {
  value = aws_apigatewayv2_api.this.execution_arn
}

output "access_log_group_name" {
  value = aws_cloudwatch_log_group.access.name
}
