output "catalog_table_name" {
  value = aws_dynamodb_table.catalog.name
}

output "catalog_table_arn" {
  value = aws_dynamodb_table.catalog.arn
}

output "catalog_index_arns" {
  description = "Index ARNs, for the IAM policies that name the exact indexes a function queries."
  value       = { for name, _ in local.catalog_gsi : name => "${aws_dynamodb_table.catalog.arn}/index/${name}" }
}

output "catalog_index_names" {
  value = keys(local.catalog_gsi)
}
