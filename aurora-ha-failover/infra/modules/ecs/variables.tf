variable "name_prefix" {
  description = "Resource name prefix, afl-{env}."
  type        = string
}

variable "region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  description = "The ALB's subnets."
  type        = list(string)
}

variable "web_subnet_ids" {
  description = "Subnets for the web tasks. Two, in AZ a and b, so the page shows requests landing in different AZs (spec section 3)."
  type        = list(string)
}

variable "app_security_group_id" {
  description = "The tasks' security group, created by the network module so Aurora could admit it first."
  type        = string
}

variable "allowed_cidr" {
  description = "The only source allowed to reach the ALB. The Makefile passes your current IP."
  type        = string
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "prober_subnet_ids" {
  description = "Subnets for the prober task."
  type        = list(string)
}

variable "web_desired_count" {
  type    = number
  default = 2
}

variable "db" {
  description = "Where the app connects. The proxy hosts are optional so the app runs without RDS Proxy."
  type = object({
    cluster_id        = string
    cluster_arn       = string
    name              = string
    secret_arn        = string
    writer_host       = string
    reader_host       = string
    proxy_writer_host = optional(string)
    proxy_reader_host = optional(string)
  })
}
