variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "alb_arn" {
  description = "Internal ALB behind the VPC origin"
  type        = string
}

variable "alb_dns_name" {
  description = "Internal ALB DNS name"
  type        = string
}

variable "documents_bucket_name" {
  description = "Documents bucket, which gets CORS for this distribution's origin"
  type        = string
}

variable "region" {
  description = "AWS Region, for the Content-Security-Policy"
  type        = string
}

variable "login_domain" {
  description = "Cognito managed login domain prefix"
  type        = string
}
