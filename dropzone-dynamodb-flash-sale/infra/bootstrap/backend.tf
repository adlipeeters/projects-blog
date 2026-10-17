# Added after the first apply: this stack's state moves into the bucket it created, so no stack
# keeps its state on one laptop. See README.md.
terraform {
  backend "s3" {
    bucket       = "dropzone-tfstate-adlipeeters"
    key          = "dropzone/bootstrap/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
