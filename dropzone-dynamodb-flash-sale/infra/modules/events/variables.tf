variable "name_prefix" {
  description = "Resource name prefix, dropzone-{env}."
  type        = string
}

variable "sweeper_function_arn" {
  description = "The hold sweeper the schedule invokes (spec section 7)."
  type        = string
}

variable "schedule_expression" {
  description = "Spec section 7: every minute. The sweeper's job is to return stock within about a minute of expiry, so this interval is part of the guarantee."
  type        = string
  default     = "rate(1 minute)"
}

variable "enabled" {
  description = "Whether the schedule is running. Turned off only to take the sweeper out of the picture during an experiment."
  type        = bool
  default     = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
