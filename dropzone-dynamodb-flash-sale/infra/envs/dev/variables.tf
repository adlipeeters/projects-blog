variable "env" {
  description = "Stage name. One stage for now, dev (spec section 1)."
  type        = string
  default     = "dev"
}

variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "carts_replica_region" {
  type    = string
  default = "us-east-1"
}

variable "service_version" {
  description = "Build identifier returned by /health. CI passes the commit sha."
  type        = string
  default     = "dev"
}

variable "api_throttling_rate_limit" {
  type    = number
  default = 200
}

variable "api_throttling_burst_limit" {
  type    = number
  default = 400
}
