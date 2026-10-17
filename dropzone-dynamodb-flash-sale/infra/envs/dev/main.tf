locals {
  name_prefix = "dropzone-${var.env}"

  # scripts/build.mjs writes one directory per handler. Run `pnpm build` before an apply.
  dist_handlers = abspath("${path.root}/../../../dist/handlers")
}

# Milestone M0: one handler, no table access, to prove the whole path works.
module "health" {
  source = "../../modules/lambda-fn"

  name        = "health"
  name_prefix = local.name_prefix
  description = "Liveness probe. No table access."
  dist_dir    = "${local.dist_handlers}/health"

  stage           = var.env
  service_version = var.service_version
}

module "api" {
  source = "../../modules/api"

  name_prefix = local.name_prefix

  routes = {
    "GET /health" = {
      function_name = module.health.function_name
      invoke_arn    = module.health.invoke_arn
    }
  }

  throttling_rate_limit  = var.api_throttling_rate_limit
  throttling_burst_limit = var.api_throttling_burst_limit
}
