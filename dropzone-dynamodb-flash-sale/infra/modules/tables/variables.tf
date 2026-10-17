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

locals {
  # Every GSI in the schema file, as the provider's key_schema blocks: HASH first, then RANGE.
  index_key_schema = {
    for index in concat(
      var.schema.tables.catalog.globalSecondaryIndexes,
      var.schema.tables.commerce.globalSecondaryIndexes,
      ) : index.name => concat(
      [{ attribute_name = index.hashKey, key_type = "HASH" }],
      try(index.rangeKey, null) == null ? [] : [{ attribute_name = index.rangeKey, key_type = "RANGE" }],
    )
  }
}
