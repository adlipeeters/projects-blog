output "registry_table_name" {
  description = "Registry table name"
  value       = aws_dynamodb_table.registry.name
}

output "registry_table_arn" {
  description = "Registry table ARN"
  value       = aws_dynamodb_table.registry.arn
}

output "documents_bucket_name" {
  description = "Documents bucket name"
  value       = aws_s3_bucket.documents.id
}

output "documents_bucket_arn" {
  description = "Documents bucket ARN"
  value       = aws_s3_bucket.documents.arn
}

output "ingest_queue_url" {
  description = "Ingest queue URL"
  value       = aws_sqs_queue.ingest.id
}

output "ingest_queue_arn" {
  description = "Ingest queue ARN"
  value       = aws_sqs_queue.ingest.arn
}

output "ingest_dlq_arn" {
  description = "Dead-letter queue ARN"
  value       = aws_sqs_queue.ingest_dlq.arn
}

output "ingest_dlq_name" {
  description = "Dead-letter queue name"
  value       = aws_sqs_queue.ingest_dlq.name
}
