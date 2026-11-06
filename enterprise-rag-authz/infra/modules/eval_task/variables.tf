variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "region" {
  description = "AWS Region"
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

variable "execution_role_arn" {
  description = "Role ECS uses to pull the image and write logs"
  type        = string
}

variable "log_group_name" {
  description = "The API log group, so the recheck proof reaches the same metric filter"
  type        = string
}
