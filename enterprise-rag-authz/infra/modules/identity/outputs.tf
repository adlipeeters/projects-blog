output "user_pool_id" {
  description = "User pool ID"
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "User pool ARN"
  value       = aws_cognito_user_pool.this.arn
}

output "web_client_id" {
  description = "Browser app client"
  value       = aws_cognito_user_pool_client.web.id
}

output "eval_client_id" {
  description = "Test script app client"
  value       = aws_cognito_user_pool_client.eval.id
}

output "login_domain" {
  description = "Cognito managed login domain prefix"
  value       = aws_cognito_user_pool_domain.this.domain
}
