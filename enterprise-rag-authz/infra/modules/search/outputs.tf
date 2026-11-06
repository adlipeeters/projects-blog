output "endpoint" {
  description = "Domain endpoint, reachable only inside the VPC"
  value       = aws_opensearch_domain.this.endpoint
}

output "domain_arn" {
  description = "Domain ARN"
  value       = aws_opensearch_domain.this.arn
}

output "admin_function_name" {
  description = "Admin Lambda name"
  value       = aws_lambda_function.admin.function_name
}
