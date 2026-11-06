variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "region" {
  description = "AWS Region"
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets"
  type        = list(string)
}

variable "app_sg_id" {
  description = "Security group for the Lambda"
  type        = string
}

variable "registry_table_name" {
  description = "Registry table name"
  type        = string
}

variable "registry_table_arn" {
  description = "Registry table ARN"
  type        = string
}

variable "documents_bucket_name" {
  description = "Documents bucket name"
  type        = string
}

variable "documents_bucket_arn" {
  description = "Documents bucket ARN"
  type        = string
}

variable "ingest_queue_arn" {
  description = "Queue the Lambda reads"
  type        = string
}

variable "search_endpoint" {
  description = "OpenSearch endpoint"
  type        = string
}

variable "search_domain_arn" {
  description = "OpenSearch domain ARN"
  type        = string
}

variable "function_timeout" {
  description = "Seconds. The queue's visibility timeout is 6 times this"
  type        = number
  default     = 300
}
