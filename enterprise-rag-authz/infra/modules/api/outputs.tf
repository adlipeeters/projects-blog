output "task_role_arn" {
  description = "Task role, allowed on the OpenSearch domain"
  value       = aws_iam_role.task.arn
}

output "repository_url" {
  description = "ECR repository"
  value       = aws_ecr_repository.this.repository_url
}

output "cluster_name" {
  description = "ECS cluster"
  value       = aws_ecs_cluster.this.name
}

output "service_name" {
  description = "ECS service"
  value       = aws_ecs_service.this.name
}

output "alb_arn" {
  description = "Internal ALB, CloudFront's VPC origin"
  value       = aws_lb.this.arn
}

output "log_group_name" {
  description = "API log group"
  value       = aws_cloudwatch_log_group.this.name
}

output "alb_dns_name" {
  description = "Internal ALB DNS name"
  value       = aws_lb.this.dns_name
}

output "execution_role_arn" {
  description = "ECS execution role, also used by the eval task"
  value       = aws_iam_role.execution.arn
}

output "alb_arn_suffix" {
  description = "ALB dimension for CloudWatch"
  value       = aws_lb.this.arn_suffix
}
