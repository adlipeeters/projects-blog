variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "region" {
  description = "AWS Region"
  type        = string
}

variable "subnet_id" {
  description = "The one subnet the single-node domain sits in"
  type        = string
}

variable "lambda_subnets" {
  description = "Subnets for the admin Lambda"
  type        = list(string)
}

variable "search_sg_id" {
  description = "Security group for the domain"
  type        = string
}

variable "app_sg_id" {
  description = "Security group for the admin Lambda"
  type        = string
}

variable "search_admin_zip" {
  description = "Path to the admin Lambda package"
  type        = string
}

variable "engine_version" {
  description = "OpenSearch version. The hybrid query's top-level filter needs 3.0 or later"
  type        = string
  default     = "OpenSearch_3.7"
}

variable "instance_type" {
  description = "Data node size. T3 is a listed shortcut (spec section 13)"
  type        = string
  default     = "t3.medium.search"
}

variable "client_role_arns" {
  description = "IAM roles allowed to call the domain, besides the admin Lambda"
  type        = list(string)
  default     = []
}
