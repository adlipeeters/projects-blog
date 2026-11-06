provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "enterprise-rag-authz"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}
