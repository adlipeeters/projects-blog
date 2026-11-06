locals {
  name_prefix = "erag-${var.env}"
}

module "network" {
  source = "../../modules/network"

  name_prefix = local.name_prefix
  region      = var.region
  azs         = var.azs
}

module "search" {
  source = "../../modules/search"

  name_prefix      = local.name_prefix
  region           = var.region
  subnet_id        = module.network.private_subnet_ids[0]
  lambda_subnets   = module.network.private_subnet_ids
  search_sg_id     = module.network.search_sg_id
  app_sg_id        = module.network.app_sg_id
  search_admin_zip = var.search_admin_zip
  client_role_arns = [module.ingest.role_arn, module.api.task_role_arn, module.eval_task.role_arn]
}

module "data" {
  source = "../../modules/data"

  name_prefix = local.name_prefix
}

module "identity" {
  source = "../../modules/identity"

  name_prefix   = local.name_prefix
  callback_urls = concat(var.web_callback_urls, ["${module.edge.url}/"])
}

module "ingest" {
  source = "../../modules/ingest"

  name_prefix           = local.name_prefix
  region                = var.region
  subnet_ids            = module.network.private_subnet_ids
  app_sg_id             = module.network.app_sg_id
  registry_table_name   = module.data.registry_table_name
  registry_table_arn    = module.data.registry_table_arn
  documents_bucket_name = module.data.documents_bucket_name
  documents_bucket_arn  = module.data.documents_bucket_arn
  ingest_queue_arn      = module.data.ingest_queue_arn
  search_endpoint       = module.search.endpoint
  search_domain_arn     = module.search.domain_arn
}

module "api" {
  source = "../../modules/api"

  name_prefix           = local.name_prefix
  region                = var.region
  vpc_id                = module.network.vpc_id
  vpc_cidr              = module.network.vpc_cidr
  subnet_ids            = module.network.private_subnet_ids
  app_sg_id             = module.network.app_sg_id
  cognito_issuer        = "https://cognito-idp.${var.region}.amazonaws.com/${module.identity.user_pool_id}"
  cognito_client_ids    = [module.identity.web_client_id, module.identity.eval_client_id]
  registry_table_name   = module.data.registry_table_name
  registry_table_arn    = module.data.registry_table_arn
  documents_bucket_name = module.data.documents_bucket_name
  documents_bucket_arn  = module.data.documents_bucket_arn
  search_endpoint       = module.search.endpoint
  search_domain_arn     = module.search.domain_arn
  rerank_min_score      = var.rerank_min_score
}

module "edge" {
  source = "../../modules/edge"

  name_prefix           = local.name_prefix
  alb_arn               = module.api.alb_arn
  alb_dns_name          = module.api.alb_dns_name
  documents_bucket_name = module.data.documents_bucket_name
  region                = var.region
  login_domain          = module.identity.login_domain
}

module "eval_task" {
  source = "../../modules/eval_task"

  name_prefix        = local.name_prefix
  region             = var.region
  search_endpoint    = module.search.endpoint
  search_domain_arn  = module.search.domain_arn
  execution_role_arn = module.api.execution_role_arn
  log_group_name     = module.api.log_group_name
}

module "observability" {
  source = "../../modules/observability"

  name_prefix           = local.name_prefix
  api_log_group_name    = module.api.log_group_name
  ingest_log_group_name = module.ingest.log_group_name
  ingest_dlq_name       = module.data.ingest_dlq_name
  alb_arn_suffix        = module.api.alb_arn_suffix
}
