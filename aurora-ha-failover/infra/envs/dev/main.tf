locals {
  name_prefix = "afl-${var.env}"
  azs         = ["${var.region}a", "${var.region}b", "${var.region}c"]
}

module "network" {
  source = "../../modules/network"

  name_prefix = local.name_prefix
  azs         = local.azs
}

# Spec section 3: afl-dev-1 starts as the writer, afl-dev-2 is the first promotion candidate, and
# afl-dev-3 in tier 1 is promoted only if both tier-0 instances are gone. afl-dev-1 is in tier 0
# too, so after it has been demoted it is a candidate again on the next run.
module "aurora" {
  source = "../../modules/aurora"

  name_prefix    = local.name_prefix
  vpc_id         = module.network.vpc_id
  subnet_ids     = module.network.db_subnet_ids
  instance_class = var.instance_class

  client_security_groups = {
    app   = module.network.app_security_group_id
    proxy = module.proxy.security_group_id
  }

  instances = [
    { suffix = "1", az = local.azs[0], tier = 0 },
    { suffix = "2", az = local.azs[1], tier = 0 },
    { suffix = "3", az = local.azs[2], tier = 1 },
  ]
}

module "proxy" {
  source = "../../modules/proxy"

  name_prefix              = local.name_prefix
  vpc_id                   = module.network.vpc_id
  subnet_ids               = module.network.db_subnet_ids
  cluster_id               = module.aurora.cluster_id
  secret_arn               = module.aurora.master_secret_arn
  client_security_group_id = module.network.app_security_group_id
  db_security_group_id     = module.aurora.db_security_group_id
}

# Two web tasks in AZ a and b, so the page shows requests landing in different AZs.
module "ecs" {
  source = "../../modules/ecs"

  name_prefix           = local.name_prefix
  region                = var.region
  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  web_subnet_ids        = slice(module.network.app_subnet_ids, 0, 2)
  prober_subnet_ids     = module.network.app_subnet_ids
  app_security_group_id = module.network.app_security_group_id
  allowed_cidr          = var.allowed_cidr
  image_tag             = var.image_tag

  db = {
    cluster_id  = module.aurora.cluster_id
    cluster_arn = module.aurora.cluster_arn
    name        = module.aurora.database_name
    secret_arn  = module.aurora.master_secret_arn
    writer_host = module.aurora.writer_endpoint
    reader_host = module.aurora.reader_endpoint

    proxy_writer_host = module.proxy.writer_endpoint
    proxy_reader_host = module.proxy.reader_endpoint
  }
}
