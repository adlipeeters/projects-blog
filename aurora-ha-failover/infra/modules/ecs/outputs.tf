output "url" {
  value = "http://${aws_lb.this.dns_name}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "web_service_name" {
  value = aws_ecs_service.web.name
}

output "prober_service_name" {
  value = aws_ecs_service.prober.name
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.app.name
}
