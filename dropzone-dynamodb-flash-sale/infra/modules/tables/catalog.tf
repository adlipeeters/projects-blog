# The catalog table: products and variants.
#
# Provisioned capacity with target-tracking auto scaling, because product reads are steady and
# dominate writes, which makes provisioned cheaper than on-demand (spec section 5). The commerce
# table is the opposite case and arrives in M2.

locals {
  catalog = var.schema.tables.catalog

  catalog_name = "${var.name_prefix}-${local.catalog.nameSuffix}"

  # Only the attributes that are part of a key or an index are declared to DynamoDB. Everything
  # else about an item is schemaless, which is the point.
  catalog_gsi = { for index in local.catalog.globalSecondaryIndexes : index.name => index }
}

resource "aws_dynamodb_table" "catalog" {
  name         = local.catalog_name
  billing_mode = local.catalog.billingMode
  hash_key     = local.catalog.hashKey
  range_key    = local.catalog.rangeKey

  # Auto scaling moves these; the values here are only the floor it starts from.
  read_capacity  = local.catalog.autoscaling.read.min
  write_capacity = local.catalog.autoscaling.write.min

  dynamic "attribute" {
    for_each = local.catalog.attributes

    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  dynamic "global_secondary_index" {
    for_each = local.catalog_gsi

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

      # INCLUDE keeps the index small: a category listing needs a name, a price and an image, not
      # the whole product item.
      non_key_attributes = global_secondary_index.value.projectionType == "INCLUDE" ? global_secondary_index.value.nonKeyAttributes : null

      read_capacity  = local.catalog.autoscaling.read.min
      write_capacity = local.catalog.autoscaling.write.min
    }
  }

  point_in_time_recovery {
    enabled = local.catalog.pointInTimeRecovery
  }

  deletion_protection_enabled = local.catalog.deletionProtection

  tags = var.tags

  lifecycle {
    # Deletion protection stops the API call; this stops Terraform proposing it in the first place,
    # including the table replacement that adding an LSI later would cause.
    prevent_destroy = true

    # Auto scaling owns capacity at runtime. Without this, every plan wants to pull the numbers back
    # to the floor above and would fight the scaling policies on each apply.
    #
    # The cost of ignoring the whole GSI block, rather than just its capacity, is that an index
    # change needs this line relaxed for one apply. That is rare and deliberate; capacity drift
    # would otherwise be constant.
    ignore_changes = [read_capacity, write_capacity, global_secondary_index]
  }
}

# ---------------------------------------------------------------------------
# Target-tracking auto scaling, table and index, reads and writes.
# ---------------------------------------------------------------------------

locals {
  # One entry per scalable dimension: the table's reads and writes, plus the same for every GSI.
  catalog_scaling = merge(
    {
      "table-read" = {
        resource_id        = "table/${aws_dynamodb_table.catalog.name}"
        scalable_dimension = "dynamodb:table:ReadCapacityUnits"
        metric             = "DynamoDBReadCapacityUtilization"
        min                = local.catalog.autoscaling.read.min
        max                = local.catalog.autoscaling.read.max
      }
      "table-write" = {
        resource_id        = "table/${aws_dynamodb_table.catalog.name}"
        scalable_dimension = "dynamodb:table:WriteCapacityUnits"
        metric             = "DynamoDBWriteCapacityUtilization"
        min                = local.catalog.autoscaling.write.min
        max                = local.catalog.autoscaling.write.max
      }
    },
    merge([
      for name, index in local.catalog_gsi : {
        "${name}-read" = {
          resource_id        = "table/${aws_dynamodb_table.catalog.name}/index/${name}"
          scalable_dimension = "dynamodb:index:ReadCapacityUnits"
          metric             = "DynamoDBReadCapacityUtilization"
          min                = local.catalog.autoscaling.read.min
          max                = local.catalog.autoscaling.read.max
        }
        "${name}-write" = {
          resource_id        = "table/${aws_dynamodb_table.catalog.name}/index/${name}"
          scalable_dimension = "dynamodb:index:WriteCapacityUnits"
          metric             = "DynamoDBWriteCapacityUtilization"
          min                = local.catalog.autoscaling.write.min
          max                = local.catalog.autoscaling.write.max
        }
      }
    ]...)
  )
}

resource "aws_appautoscaling_target" "catalog" {
  for_each = local.catalog_scaling

  service_namespace  = "dynamodb"
  resource_id        = each.value.resource_id
  scalable_dimension = each.value.scalable_dimension
  min_capacity       = each.value.min
  max_capacity       = each.value.max
}

resource "aws_appautoscaling_policy" "catalog" {
  for_each = local.catalog_scaling

  name               = "${each.key}-target-tracking"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.catalog[each.key].service_namespace
  resource_id        = aws_appautoscaling_target.catalog[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.catalog[each.key].scalable_dimension

  target_tracking_scaling_policy_configuration {
    # 70% leaves headroom for a burst while still paying for most of what is provisioned.
    target_value = local.catalog.autoscaling.targetUtilizationPercent

    predefined_metric_specification {
      predefined_metric_type = each.value.metric
    }
  }
}
