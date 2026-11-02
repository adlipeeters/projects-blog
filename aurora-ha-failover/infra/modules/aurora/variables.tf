variable "name_prefix" {
  description = "Resource name prefix, afl-{env}. Also the cluster identifier."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "The three DB subnets, one per AZ."
  type        = list(string)
}

variable "client_security_groups" {
  description = "Security groups allowed to reach port 5432, by a fixed name: the ECS tasks now, RDS Proxy from M2. A map and not a list because the ids are unknown until apply and for_each needs known keys."
  type        = map(string)
}

variable "engine_version" {
  description = "Aurora PostgreSQL version. 18.6 is the newest that offers db.t4g.medium in eu-central-1 and RDS Proxy supports 18.3 and later (checked Nov 1, 2026)."
  type        = string
  default     = "18.6"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "database_name" {
  type    = string
  default = "afl"
}

variable "instances" {
  description = <<-EOT
    The three instances in creation order (spec section 3). The first one is created alone and
    becomes the writer; the others wait for it and join as readers. Aurora promotes the lowest
    tier first, so the tier-0 reader is the first failover candidate.
  EOT
  type = list(object({
    suffix = string
    az     = string
    tier   = number
  }))

  validation {
    condition     = length(var.instances) == 3
    error_message = "The setup is built around one writer and two readers."
  }
}
