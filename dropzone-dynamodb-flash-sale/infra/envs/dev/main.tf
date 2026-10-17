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
  }

  throttling_rate_limit  = var.api_throttling_rate_limit
  throttling_burst_limit = var.api_throttling_burst_limit
}
