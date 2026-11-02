provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "aurora-ha-failover"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}
