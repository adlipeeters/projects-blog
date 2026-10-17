# The commerce table: customers, orders, line items, stock, holds, idempotency keys and aggregates.
#
# On-demand, because a drop takes traffic from near zero to thousands of writes per second and no
# provisioned number is right both before and during that (spec section 5). The catalog table next
# door is the opposite case.
#
# Deliberately not a global table: replicas are last-writer-wins, so two Regions could each sell the
# last unit. Stock, holds and orders live in one Region.

locals {
  commerce = var.schema.tables.commerce

  commerce_name = "${var.name_prefix}-${local.commerce.nameSuffix}"

  commerce_gsi = { for index in local.commerce.globalSecondaryIndexes : index.name => index }
}

resource "aws_dynamodb_table" "commerce" {
  name         = local.commerce_name
  billing_mode = local.commerce.billingMode
  hash_key     = local.commerce.hashKey
  range_key    = local.commerce.rangeKey

  dynamic "attribute" {
    for_each = local.commerce.attributes

    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  # An LSI can only be defined when the table is created: adding one later would make Terraform
  # replace the table. This is the reason the commerce table is created with its index from the
  # start, even though nothing queries it until AP9 exists.
  dynamic "local_secondary_index" {
    for_each = { for index in local.commerce.localSecondaryIndexes : index.name => index }

    content {
      name            = local_secondary_index.value.name
      range_key       = local_secondary_index.value.rangeKey
      projection_type = local_secondary_index.value.projectionType
    }
  }

  # Create or delete one GSI per apply (spec section 12). status-date-index is deliberately absent
  # until the milestone M7 migration adds it to this live table.
  dynamic "global_secondary_index" {
    for_each = local.commerce_gsi

    content {
      name = global_secondary_index.value.name

      # key_schema rather than hash_key/range_key: the AWS provider deprecated those on index
      # blocks in favour of this, which also matches the shape of the DynamoDB API itself.
      dynamic "key_schema" {
        for_each = local.index_key_schema[global_secondary_index.value.name]

        content {
          attribute_name = key_schema.value.attribute_name
          key_type       = key_schema.value.key_type
        }
      }

      projection_type = global_secondary_index.value.projectionType

      non_key_attributes = global_secondary_index.value.projectionType == "INCLUDE" ? global_secondary_index.value.nonKeyAttributes : null
    }
  }

  # Needed by the outbox publisher and the sales aggregator in M4. Enabled now because turning a
  # stream on later means no records for anything that happened before.
  stream_enabled   = local.commerce.stream.enabled
  stream_view_type = local.commerce.stream.viewType

  # Holds, idempotency keys, aggregates and notification markers all expire. TTL is cleanup only:
  # correctness comes from the expiresAt conditions, because TTL deletes within days, not seconds.
  ttl {
    attribute_name = local.commerce.ttlAttribute
    enabled        = true
  }

  # A cost guard rather than a performance setting: it caps what a runaway loop can spend.
  dynamic "on_demand_throughput" {
    for_each = local.commerce.onDemandThroughput == null ? [] : [local.commerce.onDemandThroughput]

    content {
      max_read_request_units  = on_demand_throughput.value.maxReadRequestUnits
      max_write_request_units = on_demand_throughput.value.maxWriteRequestUnits
    }
  }

  # Raised before a load run and never lowered again, so it stays unset until M6 asks for it.
  dynamic "warm_throughput" {
    for_each = local.commerce.warmThroughput == null ? [] : [local.commerce.warmThroughput]

    content {
      read_units_per_second  = warm_throughput.value.readUnitsPerSecond
      write_units_per_second = warm_throughput.value.writeUnitsPerSecond
    }
  }

  point_in_time_recovery {
    enabled = local.commerce.pointInTimeRecovery
  }

  deletion_protection_enabled = local.commerce.deletionProtection

  tags = var.tags

  lifecycle {
    # This table holds the orders. Nothing about a plan should ever propose replacing it.
    prevent_destroy = true
  }
}

# Contributor Insights shows the most-accessed keys, which is how the hot stock item in load run A
# is identified from the console rather than inferred (spec section 9).
resource "aws_dynamodb_contributor_insights" "commerce_table" {
  count = local.commerce.contributorInsights ? 1 : 0

  table_name = aws_dynamodb_table.commerce.name
}

resource "aws_dynamodb_contributor_insights" "commerce_index" {
  for_each = local.commerce.contributorInsights ? local.commerce_gsi : {}

  table_name = aws_dynamodb_table.commerce.name
  index_name = each.key
}
