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

variable "loadtest_cpu" {
  description = "Fargate task size for the load harness. 8 vCPU because at 2 the harness was the ceiling: p50 hold-to-confirm was 1.4 s against 13 ms of server-side work (spec section 9)."
  type        = number
  default     = 8192
}

variable "loadtest_memory" {
  type    = number
  default = 16384
}

variable "loadtest_max_sockets" {
  description = "DYNAMODB_MAX_SOCKETS for the harness. At least the run's --concurrency, or the SDK's socket pool is what gets measured (spec section 9)."
  type        = number
  default     = 2500
}

variable "hold_reserved_concurrency" {
  description = "Reserved concurrency on create-hold and confirm-hold (spec section 9). -1 leaves them unreserved, which is right until a run needs the rest of the account protected from them."
  type        = number
  default     = -1
}

variable "hold_sweeper_enabled" {
  description = "Whether the per-minute hold sweeper runs. Turned off only to show what expired holds do to available stock without it."
  type        = bool
  default     = true
}
