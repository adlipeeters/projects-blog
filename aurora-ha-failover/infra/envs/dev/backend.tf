# State goes in the bucket Dropzone's bootstrap stack already created, under its own key. One
# versioned, encrypted state bucket per account is enough, and a one-day test does not need a
# bootstrap stack of its own.
terraform {
  backend "s3" {
    bucket       = "dropzone-tfstate-adlipeeters"
    key          = "aurora-ha-failover/dev/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
