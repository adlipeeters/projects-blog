# The carts table: cart headers and cart lines.
#
# On-demand, like commerce, but for the opposite reason: carts are written constantly and in small
# amounts per shopper rather than in bursts.
#
# This is the one table in the design that becomes a global table. Carts are per shopper,
# latency-sensitive and safe to replicate, because a lost concurrent update just means the shopper
# sees the other version and re-adds the item. Stock and orders are the opposite case, which is why
# commerce stays single-Region.
#
# Milestone M4 adds no routes here; the handlers, the replica and the per-Region cart-abandonment
# consumer arrive in M5. The table exists now because its design is part of the modelling story, and
# because a table created without streams could not be made global later without a stream first.

locals {
  carts = var.schema.tables.carts

  carts_name = "${var.name_prefix}-${local.carts.nameSuffix}"
}

resource "aws_dynamodb_table" "carts" {
  name         = local.carts_name
  billing_mode = local.carts.billingMode
  hash_key     = local.carts.hashKey
  range_key    = local.carts.rangeKey

  dynamic "attribute" {
    for_each = local.carts.attributes

    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  # No index at all: a cart is read by its own id and nothing else (AP3, AP4). Each line is its own
  # item rather than a map inside the header, so two Regions editing different lines cannot
  # overwrite each other.

  # Required before a replica can be added, and replication is what M5 turns on.
  stream_enabled   = local.carts.stream.enabled
  stream_view_type = local.carts.stream.viewType

  # Last activity plus 30 days, refreshed on every write. TTL deletions replicate.
  ttl {
    attribute_name = local.carts.ttlAttribute
    enabled        = true
  }

  # Empty until M5 adds the us-east-1 entry to schema/tables.json, which is the only change the
  # table itself needs to become a global table.
  dynamic "replica" {
    for_each = { for entry in local.carts.replicas : entry.regionName => entry }

    content {
      region_name = replica.value.regionName
    }
  }

  point_in_time_recovery {
    enabled = local.carts.pointInTimeRecovery
  }

  deletion_protection_enabled = local.carts.deletionProtection

  tags = var.tags

  lifecycle {
    prevent_destroy = true
  }
}
