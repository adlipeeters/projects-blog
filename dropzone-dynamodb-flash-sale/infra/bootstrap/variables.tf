variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "state_bucket_name" {
  description = "Globally unique bucket holding Terraform state for every stack in this project."
  type        = string
  default     = "dropzone-tfstate-adlipeeters"
}
