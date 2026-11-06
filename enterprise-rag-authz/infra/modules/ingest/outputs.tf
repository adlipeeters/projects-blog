output "role_arn" {
  description = "Lambda role, allowed on the OpenSearch domain"
  value       = aws_iam_role.this.arn
}

output "repository_url" {
  description = "ECR repository"
  value       = aws_ecr_repository.this.repository_url
}

output "function_name" {
  description = "Lambda name"
  value       = aws_lambda_function.this.function_name
}

output "log_group_name" {
  description = "Lambda log group"
  value       = aws_cloudwatch_log_group.this.name
}
