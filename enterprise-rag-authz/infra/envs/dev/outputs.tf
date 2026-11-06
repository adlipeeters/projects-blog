output "search_endpoint" {
  description = "OpenSearch endpoint, reachable only inside the VPC"
  value       = module.search.endpoint
}

output "search_admin_function" {
  description = "Lambda that creates the index and runs the smoke test"
  value       = module.search.admin_function_name
}

output "registry_table" {
  description = "Document registry and usage counters"
  value       = module.data.registry_table_name
}

output "documents_bucket" {
  description = "Uploaded source documents"
  value       = module.data.documents_bucket_name
}

output "ingest_queue_url" {
  description = "Queue S3 notifies on every upload"
  value       = module.data.ingest_queue_url
}

output "user_pool_id" {
  description = "Cognito user pool"
  value       = module.identity.user_pool_id
}

output "web_client_id" {
  description = "App client for the browser"
  value       = module.identity.web_client_id
}

output "eval_client_id" {
  description = "App client the test scripts log in through"
  value       = module.identity.eval_client_id
}

output "login_domain" {
  description = "Cognito managed login domain"
  value       = module.identity.login_domain
}

output "url" {
  description = "The app's HTTPS URL"
  value       = module.edge.url
}

output "web_bucket" {
  description = "Bucket for the built React app"
  value       = module.edge.web_bucket_name
}

output "api_repository_url" {
  description = "ECR repository for the API image"
  value       = module.api.repository_url
}

output "ingest_repository_url" {
  description = "ECR repository for the ingest image"
  value       = module.ingest.repository_url
}

output "ingest_function" {
  description = "Ingest Lambda"
  value       = module.ingest.function_name
}

output "ecs_cluster" {
  description = "ECS cluster"
  value       = module.api.cluster_name
}

output "ecs_service" {
  description = "ECS service"
  value       = module.api.service_name
}

output "api_log_group" {
  description = "API log group"
  value       = module.api.log_group_name
}

output "distribution_id" {
  description = "CloudFront distribution"
  value       = module.edge.distribution_id
}

output "eval_repository_url" {
  description = "ECR repository for the eval image"
  value       = module.eval_task.repository_url
}

output "eval_task_definition" {
  description = "One-off eval task"
  value       = module.eval_task.task_definition_arn
}

output "private_subnet_ids" {
  description = "Subnets for the one-off eval task"
  value       = join(",", module.network.private_subnet_ids)
}

output "app_security_group" {
  description = "Security group for the one-off eval task"
  value       = module.network.app_sg_id
}

output "recheck_alarm" {
  description = "Alarm the recheck proof expects to fire"
  value       = module.observability.recheck_alarm_name
}
