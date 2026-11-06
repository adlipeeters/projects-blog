output "role_arn" {
  description = "Task role, allowed on the OpenSearch domain"
  value       = aws_iam_role.task.arn
}

output "repository_url" {
  description = "ECR repository"
  value       = aws_ecr_repository.this.repository_url
}

output "task_definition_arn" {
  description = "Task definition"
  value       = aws_ecs_task_definition.this.arn
}
