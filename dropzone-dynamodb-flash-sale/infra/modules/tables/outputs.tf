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

output "commerce_table_name" {
  value = aws_dynamodb_table.commerce.name
}

output "commerce_table_arn" {
  value = aws_dynamodb_table.commerce.arn
}

output "commerce_stream_arn" {
  description = "For the event source mappings in M4."
  value       = aws_dynamodb_table.commerce.stream_arn
}

output "commerce_index_arns" {
  value = { for name, _ in local.commerce_gsi : name => "${aws_dynamodb_table.commerce.arn}/index/${name}" }
}

output "commerce_lsi_arns" {
  value = {
    for index in local.commerce.localSecondaryIndexes :
    index.name => "${aws_dynamodb_table.commerce.arn}/index/${index.name}"
  }
}
