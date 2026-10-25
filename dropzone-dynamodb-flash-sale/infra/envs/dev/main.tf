locals {
  name_prefix = "dropzone-${var.env}"

  # The one source of truth for table, key and index names (spec section 2). Terraform reads the
  # same file the integration tests build their DynamoDB Local tables from.
  schema = jsondecode(file("${path.root}/../../../schema/tables.json"))

  # scripts/build.mjs writes one directory per handler. Run `pnpm build` before an apply, or use
  # `pnpm deploy`, which does both.
  dist_handlers = abspath("${path.root}/../../../dist/handlers")
}

module "tables" {
  source = "../../modules/tables"

  name_prefix = local.name_prefix
  schema      = local.schema
}

# ---------------------------------------------------------------------------
# Functions. Each policy names the exact table and index its handler touches.
# ---------------------------------------------------------------------------

module "health" {
  source = "../../modules/lambda-fn"

  name        = "health"
  name_prefix = local.name_prefix
  description = "Liveness probe. No table access."
  dist_dir    = "${local.dist_handlers}/health"

  stage           = var.env
  service_version = var.service_version
}

# AP1: one Query against the catalog table, no index.
data "aws_iam_policy_document" "get_product" {
  statement {
    sid       = "QueryCatalogTable"
    effect    = "Allow"
    actions   = ["dynamodb:Query"]
    resources = [module.tables.catalog_table_arn]
  }
}

module "get_product" {
  source = "../../modules/lambda-fn"

  name        = "get-product"
  name_prefix = local.name_prefix
  description = "AP1: a product with all its variants."
  dist_dir    = "${local.dist_handlers}/get-product"

  stage           = var.env
  service_version = var.service_version
  environment     = { CATALOG_TABLE = module.tables.catalog_table_name }
  policies        = { catalog = data.aws_iam_policy_document.get_product.json }
}

# AP2: one Query against the index only. The base table is not in the resource list, so this
# function cannot read a product item even by accident.
data "aws_iam_policy_document" "list_category" {
  statement {
    sid       = "QueryCategoryPriceIndex"
    effect    = "Allow"
    actions   = ["dynamodb:Query"]
    resources = [module.tables.catalog_index_arns["category-price-index"]]
  }
}

module "list_category" {
  source = "../../modules/lambda-fn"

  name        = "list-category"
  name_prefix = local.name_prefix
  description = "AP2: products in a category by price range, cheapest first."
  dist_dir    = "${local.dist_handlers}/list-category"

  stage           = var.env
  service_version = var.service_version
  environment     = { CATALOG_TABLE = module.tables.catalog_table_name }
  policies        = { catalog-index = data.aws_iam_policy_document.list_category.json }
}

# AP5 and AP6: a transaction over two items in one table, plus the strongly consistent reads that
# find a customer afterwards. TransactWriteItems has no IAM action of its own; it needs the
# permissions of the writes it performs.
data "aws_iam_policy_document" "register_customer" {
  statement {
    sid    = "WriteAndReadCustomerItems"
    effect = "Allow"

    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
    ]

    resources = [module.tables.commerce_table_arn]
  }
}

module "register_customer" {
  source = "../../modules/lambda-fn"

  name        = "register-customer"
  name_prefix = local.name_prefix
  description = "AP5: register a customer with a unique email."
  dist_dir    = "${local.dist_handlers}/register-customer"

  stage           = var.env
  service_version = var.service_version
  environment     = { COMMERCE_TABLE = module.tables.commerce_table_name }
  policies        = { commerce = data.aws_iam_policy_document.register_customer.json }
}

# AP7. The transaction writes the idempotency item, the stock buckets, the order and its lines, and
# reads the catalog to re-price. TransactWriteItems has no IAM action of its own: it needs the
# permissions of each write it performs.
data "aws_iam_policy_document" "checkout" {
  statement {
    sid    = "WriteOrdersAndStock"
    effect = "Allow"

    actions = [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:GetItem",
      "dynamodb:Query",
    ]

    resources = [module.tables.commerce_table_arn]
  }

  statement {
    sid    = "ReadCatalogForPricing"
    effect = "Allow"

    # Read-only on the catalog: checkout re-prices from it and must never write to it.
    actions = [
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
    ]

    resources = [module.tables.catalog_table_arn]
  }
}

module "checkout" {
  source = "../../modules/lambda-fn"

  name        = "checkout"
  name_prefix = local.name_prefix
  description = "AP7: place an order in one transaction, with idempotency."
  dist_dir    = "${local.dist_handlers}/checkout"

  stage           = var.env
  service_version = var.service_version

  environment = {
    COMMERCE_TABLE = module.tables.commerce_table_name
    CATALOG_TABLE  = module.tables.catalog_table_name
  }

  policies = { checkout = data.aws_iam_policy_document.checkout.json }
}

# AP8 and AP9. The LSI needs its own resource entry: permission on a table does not extend to its
# indexes.
data "aws_iam_policy_document" "list_orders" {
  statement {
    sid       = "QueryOrdersAndStatusIndex"
    effect    = "Allow"
    actions   = ["dynamodb:Query"]
    resources = [module.tables.commerce_table_arn, module.tables.commerce_lsi_arns["customer-status-index"]]
  }
}

module "list_orders" {
  source = "../../modules/lambda-fn"

  name        = "list-orders"
  name_prefix = local.name_prefix
  description = "AP8, AP9: a customer's orders, optionally by status."
  dist_dir    = "${local.dist_handlers}/list-orders"

  stage           = var.env
  service_version = var.service_version
  environment     = { COMMERCE_TABLE = module.tables.commerce_table_name }
  policies        = { commerce = data.aws_iam_policy_document.list_orders.json }
}

# AP8 and AP10: the header by key, the lines by query. No index, no write.
data "aws_iam_policy_document" "get_order" {
  statement {
    sid       = "ReadOrderAndLines"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:Query"]
    resources = [module.tables.commerce_table_arn]
  }
}

module "get_order" {
  source = "../../modules/lambda-fn"

  name        = "get-order"
  name_prefix = local.name_prefix
  description = "AP8, AP10: an order with its line items."
  dist_dir    = "${local.dist_handlers}/get-order"

  stage           = var.env
  service_version = var.service_version
  environment     = { COMMERCE_TABLE = module.tables.commerce_table_name }
  policies        = { commerce = data.aws_iam_policy_document.get_order.json }
}

# AP11: a conditional update, or a transaction when cancelling returns units to their buckets.
data "aws_iam_policy_document" "update_order_status" {
  statement {
    sid       = "UpdateOrderAndReturnStock"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [module.tables.commerce_table_arn]
  }
}

module "update_order_status" {
  source = "../../modules/lambda-fn"

  name        = "update-order-status"
  name_prefix = local.name_prefix
  description = "AP11: change an order's status, conditional on status and version."
  dist_dir    = "${local.dist_handlers}/update-order-status"

  stage           = var.env
  service_version = var.service_version
  environment     = { COMMERCE_TABLE = module.tables.commerce_table_name }
  policies        = { commerce = data.aws_iam_policy_document.update_order_status.json }
}

# AP12: the index only. The base table is not in the resource list, so a picker screen cannot read
# an order item even by accident, and the projection is all it gets.
data "aws_iam_policy_document" "warehouse_queue" {
  statement {
    sid       = "QueryFulfillmentIndex"
    effect    = "Allow"
    actions   = ["dynamodb:Query"]
    resources = [module.tables.commerce_index_arns["fulfillment-index"]]
  }
}

module "warehouse_queue" {
  source = "../../modules/lambda-fn"

  name        = "warehouse-queue"
  name_prefix = local.name_prefix
  description = "AP12: unfulfilled orders, oldest first, merged across index shards."
  dist_dir    = "${local.dist_handlers}/warehouse-queue"

  stage           = var.env
  service_version = var.service_version
  environment     = { COMMERCE_TABLE = module.tables.commerce_table_name }
  policies        = { commerce-index = data.aws_iam_policy_document.warehouse_queue.json }
}

# AP13: the stock buckets of one sku, summed. Read-only on both tables: the bucket count comes
# from the catalog variant, the counters from commerce.
data "aws_iam_policy_document" "get_stock" {
  statement {
    sid       = "ReadStockBuckets"
    effect    = "Allow"
    actions   = ["dynamodb:BatchGetItem"]
    resources = [module.tables.commerce_table_arn]
  }

  statement {
    sid       = "ReadVariantBucketCount"
    effect    = "Allow"
    actions   = ["dynamodb:BatchGetItem"]
    resources = [module.tables.catalog_table_arn]
  }
}

module "get_stock" {
  source = "../../modules/lambda-fn"

  name        = "get-stock"
  name_prefix = local.name_prefix
  description = "AP13: available units of a sku, summed across its buckets."
  dist_dir    = "${local.dist_handlers}/get-stock"

  stage           = var.env
  service_version = var.service_version

  environment = {
    COMMERCE_TABLE = module.tables.commerce_table_name
    CATALOG_TABLE  = module.tables.catalog_table_name
  }

  policies = { stock = data.aws_iam_policy_document.get_stock.json }
}

# AP15, create. The same writes checkout performs, minus the order: the idempotency item, the
# conditional bucket decrements, and the hold itself.
data "aws_iam_policy_document" "create_hold" {
  statement {
    sid    = "WriteHoldAndTakeStock"
    effect = "Allow"

    actions = [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:GetItem",
    ]

    resources = [module.tables.commerce_table_arn]
  }

  statement {
    sid    = "ReadCatalogForPricing"
    effect = "Allow"

    # Read-only on the catalog: a hold snapshots prices from it and must never write to it.
    actions = [
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
    ]

    resources = [module.tables.catalog_table_arn]
  }
}

module "create_hold" {
  source = "../../modules/lambda-fn"

  name        = "create-hold"
  name_prefix = local.name_prefix
  description = "AP15: hold stock for ten minutes, in one transaction."
  dist_dir    = "${local.dist_handlers}/create-hold"

  stage           = var.env
  service_version = var.service_version

  environment = {
    COMMERCE_TABLE = module.tables.commerce_table_name
    CATALOG_TABLE  = module.tables.catalog_table_name
  }

  policies             = { create-hold = data.aws_iam_policy_document.create_hold.json }
  reserved_concurrency = var.hold_reserved_concurrency
}

# AP15, confirm. No stock actions and no catalog access at all: the units were taken when the hold
# was created, and the prices come from the hold's own snapshot.
data "aws_iam_policy_document" "confirm_hold" {
  statement {
    sid    = "ConfirmHoldAndWriteOrder"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]

    resources = [module.tables.commerce_table_arn]
  }
}

module "confirm_hold" {
  source = "../../modules/lambda-fn"

  name        = "confirm-hold"
  name_prefix = local.name_prefix
  description = "AP15: turn a hold into an order, in one transaction."
  dist_dir    = "${local.dist_handlers}/confirm-hold"

  stage           = var.env
  service_version = var.service_version
  environment     = { COMMERCE_TABLE = module.tables.commerce_table_name }

  policies             = { confirm-hold = data.aws_iam_policy_document.confirm_hold.json }
  reserved_concurrency = var.hold_reserved_concurrency
}

# AP15, release. Reads the hold for its allocations, then closes it and credits the buckets.
data "aws_iam_policy_document" "release_hold" {
  statement {
    sid       = "ReleaseHoldAndReturnStock"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [module.tables.commerce_table_arn]
  }
}

module "release_hold" {
  source = "../../modules/lambda-fn"

  name        = "release-hold"
  name_prefix = local.name_prefix
  description = "AP15: close a hold and return its units to their buckets."
  dist_dir    = "${local.dist_handlers}/release-hold"

  stage           = var.env
  service_version = var.service_version
  environment     = { COMMERCE_TABLE = module.tables.commerce_table_name }
  policies        = { release-hold = data.aws_iam_policy_document.release_hold.json }
}

# AP15, the sweeper. Queries the holds index, then releases through the table. The index is listed
# separately because permission on a table does not extend to its indexes.
data "aws_iam_policy_document" "hold_sweeper" {
  statement {
    sid       = "QueryExpiredHolds"
    effect    = "Allow"
    actions   = ["dynamodb:Query"]
    resources = [module.tables.commerce_index_arns["holds-index"]]
  }

  statement {
    sid       = "ReleaseExpiredHolds"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [module.tables.commerce_table_arn]
  }
}

module "hold_sweeper" {
  source = "../../modules/lambda-fn"

  name        = "hold-sweeper"
  name_prefix = local.name_prefix
  description = "AP15: release expired holds every minute. The timer TTL cannot be."
  dist_dir    = "${local.dist_handlers}/hold-sweeper"

  stage           = var.env
  service_version = var.service_version
  environment     = { COMMERCE_TABLE = module.tables.commerce_table_name }
  policies        = { hold-sweeper = data.aws_iam_policy_document.hold_sweeper.json }

  # Up to a hundred releases per run, each a transaction. Thirty seconds is generous and still well
  # inside the minute before the next run.
  timeout = 30
}

# ---------------------------------------------------------------------------
# Schedules (spec section 7)
# ---------------------------------------------------------------------------

module "events" {
  source = "../../modules/events"

  name_prefix          = local.name_prefix
  sweeper_function_arn = module.hold_sweeper.function_arn
  enabled              = var.hold_sweeper_enabled
}

# ---------------------------------------------------------------------------
# Load harness (spec section 9)
# ---------------------------------------------------------------------------

module "loadtest" {
  source = "../../modules/loadtest"

  name_prefix         = local.name_prefix
  commerce_table_arn  = module.tables.commerce_table_arn
  commerce_table_name = module.tables.commerce_table_name
  catalog_table_arn   = module.tables.catalog_table_arn
  catalog_table_name  = module.tables.catalog_table_name

  cpu         = var.loadtest_cpu
  memory      = var.loadtest_memory
  max_sockets = var.loadtest_max_sockets
}

# ---------------------------------------------------------------------------
# Routes (spec section 7)
# ---------------------------------------------------------------------------

module "api" {
  source = "../../modules/api"

  name_prefix = local.name_prefix

  routes = {
    "GET /health" = {
      function_name = module.health.function_name
      invoke_arn    = module.health.invoke_arn
    }
    "GET /products/{productId}" = {
      function_name = module.get_product.function_name
      invoke_arn    = module.get_product.invoke_arn
    }
    "GET /categories/{categoryId}/products" = {
      function_name = module.list_category.function_name
      invoke_arn    = module.list_category.invoke_arn
    }
    "POST /customers" = {
      function_name = module.register_customer.function_name
      invoke_arn    = module.register_customer.invoke_arn
    }
    "POST /checkout" = {
      function_name = module.checkout.function_name
      invoke_arn    = module.checkout.invoke_arn
    }
    "GET /customers/{customerId}/orders" = {
      function_name = module.list_orders.function_name
      invoke_arn    = module.list_orders.invoke_arn
    }
    "GET /customers/{customerId}/orders/{orderId}" = {
      function_name = module.get_order.function_name
      invoke_arn    = module.get_order.invoke_arn
    }
    "PATCH /customers/{customerId}/orders/{orderId}" = {
      function_name = module.update_order_status.function_name
      invoke_arn    = module.update_order_status.invoke_arn
    }
    "GET /warehouse/queue" = {
      function_name = module.warehouse_queue.function_name
      invoke_arn    = module.warehouse_queue.invoke_arn
    }
    "GET /skus/{sku}/stock" = {
      function_name = module.get_stock.function_name
      invoke_arn    = module.get_stock.invoke_arn
    }
    "POST /checkout/holds" = {
      function_name = module.create_hold.function_name
      invoke_arn    = module.create_hold.invoke_arn
    }
    "POST /checkout/holds/{holdId}/confirm" = {
      function_name = module.confirm_hold.function_name
      invoke_arn    = module.confirm_hold.invoke_arn
    }
    "DELETE /checkout/holds/{holdId}" = {
      function_name = module.release_hold.function_name
      invoke_arn    = module.release_hold.invoke_arn
    }
  }

  throttling_rate_limit  = var.api_throttling_rate_limit
  throttling_burst_limit = var.api_throttling_burst_limit
}
