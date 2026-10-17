variable "name_prefix" {
  description = "Resource name prefix, dropzone-{env}."
  type        = string
}

variable "routes" {
  description = <<-EOT
    One entry per route, keyed by the route key API Gateway uses, for example "GET /products/{productId}".
    Each value names the handler it integrates with. Spec section 7 lists every route.
  EOT

  type = map(object({
    function_name = string
    invoke_arn    = string
    # Per-route timeout in milliseconds. API Gateway's own ceiling is 30s.
    timeout_ms = optional(number, 10000)
  }))
}

variable "throttling_rate_limit" {
  description = "Stage-level requests per second. A drop is protected by this plus reserved concurrency (spec section 9)."
  type        = number
  default     = 200
}

variable "throttling_burst_limit" {
  type    = number
  default = 400
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "tags" {
  type    = map(string)
  default = {}
}
