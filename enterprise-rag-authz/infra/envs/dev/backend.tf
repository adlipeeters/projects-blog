# State goes in the bucket Dropzone's bootstrap stack already created, under its own key.
terraform {
  backend "s3" {
    bucket       = "dropzone-tfstate-adlipeeters"
    key          = "enterprise-rag-authz/dev/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
