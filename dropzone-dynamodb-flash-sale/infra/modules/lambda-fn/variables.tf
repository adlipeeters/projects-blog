variable "name" {
  description = "Function name without the prefix, for example \"health\". Must match the bundle directory produced by scripts/build.mjs."
  type        = string
}

variable "name_prefix" {
  description = "Resource name prefix, dropzone-{env}."
  type        = string
}

variable "description" {
  description = "What the function does, shown in the console."
  type        = string
}

variable "dist_dir" {
  description = "Directory holding the esbuild output for this function, zipped as-is."
  type        = string
}

variable "handler" {
  description = "Lambda handler. The build always emits index.js exporting handler."
  type        = string
  default     = "index.handler"
}

variable "runtime" {
  type    = string
  default = "nodejs22.x"
}

variable "memory_size" {
  description = "Spec section 7 default: 512 MB."
  type        = number
  default     = 512
}

variable "timeout" {
  description = "Spec section 7 default: 10 seconds."
  type        = number
  default     = 10
}

variable "reserved_concurrency" {
  description = "Reserved concurrent executions. -1 means unreserved. Set for create-hold and confirm-hold before a load run (spec section 9)."
  type        = number
  default     = -1
}

variable "environment" {
  description = "Extra environment variables, merged over the defaults this module sets."
  type        = map(string)
  default     = {}
}

variable "policies" {
  description = <<-EOT
    Inline least-privilege IAM policies for this function, passed in by the caller (spec section 12),
    keyed by a short name that becomes the inline policy name: { catalog = data.aws_iam_policy_document.x.json }.

    A map rather than a single string because the keys are known at plan time while the documents
    are not: they refer to table and index ARNs that do not exist until apply. A `count` on an
    unknown value cannot be planned at all, which is the error this shape avoids.

    Empty means the function needs nothing beyond its own logs and traces.
  EOT
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  description = "Spec section 12: 14 days."
  type        = number
  default     = 14
}

variable "stage" {
  type = string
}

variable "service_version" {
  description = "Returned by /health and attached to logs, so a deployed function says which build it is."
  type        = string
  default     = "dev"
}

variable "tags" {
  type    = map(string)
  default = {}
}
