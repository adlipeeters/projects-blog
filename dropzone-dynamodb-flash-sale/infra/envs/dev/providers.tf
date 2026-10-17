provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "dropzone"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}

# The carts replica Region. Its Lambda and event bus arrive in milestone M5; the provider is
# declared now so the wiring is visible from the start (spec section 12).
provider "aws" {
  alias  = "us_east_1"
  region = var.carts_replica_region

  default_tags {
    tags = {
      Project   = "dropzone"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}
