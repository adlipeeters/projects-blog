output "cluster_id" {
  value = module.aurora.cluster_id
}

output "writer_endpoint" {
  value = module.aurora.writer_endpoint
}

output "reader_endpoint" {
  value = module.aurora.reader_endpoint
}

output "database_name" {
  value = module.aurora.database_name
}

output "master_secret_arn" {
  value = module.aurora.master_secret_arn
}

output "instance_ids" {
  value = module.aurora.instance_ids
}

output "vpc_id" {
  value = module.network.vpc_id
}

output "app_subnet_ids" {
  value = module.network.app_subnet_ids
}

output "app_security_group_id" {
  value = module.network.app_security_group_id
}

output "url" {
  description = "The page. Reachable from allowed_cidr only."
  value       = module.ecs.url
}

output "ecr_repository_url" {
  value = module.ecs.ecr_repository_url
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "web_service_name" {
  value = module.ecs.web_service_name
}

output "prober_service_name" {
  value = module.ecs.prober_service_name
}

output "proxy_writer_endpoint" {
  value = module.proxy.writer_endpoint
}

output "proxy_reader_endpoint" {
  value = module.proxy.reader_endpoint
}

output "log_group_name" {
  value = module.ecs.log_group_name
}
