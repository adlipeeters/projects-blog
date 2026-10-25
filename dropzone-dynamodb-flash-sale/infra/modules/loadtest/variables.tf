variable "name_prefix" {
  description = "Resource name prefix, dropzone-{env}."
  type        = string
}

variable "commerce_table_arn" {
  description = "The table the harness writes holds and orders to."
  type        = string
}

variable "commerce_table_name" {
  type = string
}

variable "catalog_table_arn" {
  description = "Read-only: the harness prices lines from the catalog, exactly as create-hold does."
  type        = string
}

variable "catalog_table_name" {
  type = string
}

variable "cpu" {
  description = "Fargate task size. 2 vCPU is enough for a few hundred in-flight signed requests; the signing and TLS are what cost CPU, not the waiting."
  type        = number
  default     = 2048
}

variable "memory" {
  type    = number
  default = 4096
}

variable "max_sockets" {
  description = "DYNAMODB_MAX_SOCKETS. Must be at least the --concurrency the run uses, or the SDK's socket pool becomes the bottleneck and the run measures that instead of the partition (spec section 9)."
  type        = number
  default     = 500
}

variable "command" {
  description = "Default arguments for the harness. Override per run with `aws ecs run-task --overrides`."
  type        = list(string)
  default     = ["--sku", "DROP-TEE-M-BLK", "--concurrency", "400", "--duration", "120"]
}

variable "subnet_ids" {
  description = "Public subnets to run in. Empty means the default VPC's, which is the cheap option: a public IP and no NAT gateway, instead of five cents an hour for a NAT the task uses for two minutes."
  type        = list(string)
  default     = []
}

variable "log_retention_days" {
  description = "A run's logs are read within the hour and the summary is copied into the article."
  type        = number
  default     = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
