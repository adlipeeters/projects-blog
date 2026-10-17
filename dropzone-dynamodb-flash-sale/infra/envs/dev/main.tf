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
  }

  throttling_rate_limit  = var.api_throttling_rate_limit
  throttling_burst_limit = var.api_throttling_burst_limit
}
