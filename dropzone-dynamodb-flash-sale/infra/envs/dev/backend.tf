# State in S3 with native lockfile locking, which Terraform 1.10 added. No DynamoDB lock table is
# needed, which is a pleasant irony for this project.
#
# The bucket is created by infra/bootstrap, which must be applied first.
terraform {
  backend "s3" {
    bucket       = "dropzone-tfstate-adlipeeters"
    key          = "dropzone/dev/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
