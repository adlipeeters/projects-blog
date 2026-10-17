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
