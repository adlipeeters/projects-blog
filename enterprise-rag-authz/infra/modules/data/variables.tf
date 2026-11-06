variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "ingest_function_timeout" {
  description = "Ingestion Lambda timeout in seconds. The queue's visibility timeout is 6 times this"
  type        = number
  default     = 300
}
