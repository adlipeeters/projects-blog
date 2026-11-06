variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "region" {
  description = "AWS Region, for endpoint service names"
  type        = string
}

variable "azs" {
  description = "Availability Zones"
  type        = list(string)
}

variable "cidr_block" {
  description = "VPC CIDR"
  type        = string
  default     = "10.50.0.0/16"
}
