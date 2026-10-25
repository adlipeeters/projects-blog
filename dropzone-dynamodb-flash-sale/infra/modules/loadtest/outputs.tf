output "ecr_repository_url" {
  description = "Push the image here before a run."
  value       = aws_ecr_repository.harness.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.harness.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.harness.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.harness.name
}

output "network_configuration" {
  description = "The --network-configuration for `aws ecs run-task`."
  value = format(
    "awsvpcConfiguration={subnets=[%s],securityGroups=[%s],assignPublicIp=ENABLED}",
    join(",", local.subnet_ids),
    aws_security_group.harness.id,
  )
}

output "run_task_command" {
  description = "Ready to paste. Add --overrides to change the harness flags for one run."
  value = join(" ", [
    "aws ecs run-task",
    "--cluster ${aws_ecs_cluster.harness.name}",
    "--task-definition ${aws_ecs_task_definition.harness.family}",
    "--launch-type FARGATE",
    "--region ${data.aws_region.current.region}",
    format(
      "--network-configuration 'awsvpcConfiguration={subnets=[%s],securityGroups=[%s],assignPublicIp=ENABLED}'",
      join(",", local.subnet_ids),
      aws_security_group.harness.id,
    ),
  ])
}
