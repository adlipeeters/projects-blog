variable "env" {
  description = "Stage name. One stage, dev."
  type        = string
  default     = "dev"
}

variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "allowed_cidr" {
  description = "The only source allowed to reach the ALB, as a /32. The Makefile fills it with your current public IP."
  type        = string

  validation {
    condition     = can(cidrhost(var.allowed_cidr, 0))
    error_message = "allowed_cidr must be a CIDR block, for example 203.0.113.7/32."
  }
}

variable "image_tag" {
  type    = string
  default = "latest"
}
