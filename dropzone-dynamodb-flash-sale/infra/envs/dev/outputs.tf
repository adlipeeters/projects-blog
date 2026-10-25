output "api_endpoint" {
  description = "Base URL of the HTTP API."
  value       = module.api.api_endpoint
}

output "health_url" {
  # invoke_url of the $default stage ends with a slash.
  value = "${trimsuffix(module.api.api_endpoint, "/")}/health"
}

output "health_function_name" {
  value = module.health.function_name
}

output "api_access_log_group" {
  value = module.api.access_log_group_name
}

output "catalog_table_name" {
  value = module.tables.catalog_table_name
}

output "catalog_index_names" {
  value = module.tables.catalog_index_names
}

output "commerce_table_name" {
  value = module.tables.commerce_table_name
}

output "commerce_stream_arn" {
  value = module.tables.commerce_stream_arn
}

output "carts_table_name" {
  value = module.tables.carts_table_name
}

output "hold_sweeper_function_name" {
  value = module.hold_sweeper.function_name
}

output "hold_sweeper_schedule_name" {
  value = module.events.hold_sweeper_schedule_name
}

output "loadtest_ecr_repository_url" {
  description = "Push the harness image here before a load run."
  value       = module.loadtest.ecr_repository_url
}

output "loadtest_run_task_command" {
  value = module.loadtest.run_task_command
}

output "loadtest_network_configuration" {
  description = "The --network-configuration for `aws ecs run-task`."
  value       = module.loadtest.network_configuration
}

output "loadtest_log_group" {
  value = module.loadtest.log_group_name
}
