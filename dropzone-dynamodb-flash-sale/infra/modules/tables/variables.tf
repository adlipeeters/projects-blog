variable "name_prefix" {
  description = "Resource name prefix, dropzone-{env}."
  type        = string
}

variable "schema" {
  description = <<-EOT
    The decoded schema/tables.json. Table names, key attribute names, index names and shard counts
    come from there and nowhere else, so Terraform and the integration tests cannot drift.
    Typed as any because the three tables have deliberately different shapes.
  EOT
  type        = any
}

variable "tags" {
  type    = map(string)
  default = {}
}
