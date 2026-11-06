variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "api_log_group_name" {
  description = "API log group, which holds the audit records"
  type        = string
}

variable "ingest_log_group_name" {
  description = "Ingest Lambda log group"
  type        = string
}

variable "ingest_dlq_name" {
  description = "Ingest dead-letter queue"
  type        = string
}

variable "alb_arn_suffix" {
  description = "ALB dimension for CloudWatch"
  type        = string
}
