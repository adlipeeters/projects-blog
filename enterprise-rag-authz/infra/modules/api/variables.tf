variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "region" {
  description = "AWS Region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR, for ALB traffic to the tasks"
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the ALB and the tasks"
  type        = list(string)
}

variable "app_sg_id" {
  description = "Security group for the tasks"
  type        = string
}

variable "cognito_issuer" {
  description = "Token issuer URL"
  type        = string
}

variable "cognito_client_ids" {
  description = "App clients whose access tokens the API accepts"
  type        = list(string)
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

variable "search_endpoint" {
  description = "OpenSearch endpoint"
  type        = string
}

variable "search_domain_arn" {
  description = "OpenSearch domain ARN"
  type        = string
}

variable "desired_count" {
  description = "API tasks. Two is why the usage counters have to be shared"
  type        = number
  default     = 2
}

variable "answer_model" {
  description = "Inference profile for answers. Claude is blocked on this account"
  type        = string
  default     = "eu.amazon.nova-pro-v1:0"
}

variable "rerank_min_score" {
  description = "Below this rerank score, the API answers not found without calling the model"
  type        = string
  default     = "0.005"
}
