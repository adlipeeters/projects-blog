variable "name_prefix" {
  description = "Resource name prefix, afl-{env}."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "The three DB subnets. The proxy runs in the same tier as the instances."
  type        = list(string)
}

variable "cluster_id" {
  type = string
}

variable "secret_arn" {
  description = "The RDS-managed master secret. The proxy logs in to the cluster with it."
  type        = string
}

variable "client_security_group_id" {
  description = "The tasks' security group, the only client allowed in."
  type        = string
}

variable "db_security_group_id" {
  description = "The instances' security group, the proxy's only destination."
  type        = string
}
