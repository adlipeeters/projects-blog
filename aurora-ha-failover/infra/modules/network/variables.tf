variable "name_prefix" {
  description = "Resource name prefix, afl-{env}."
  type        = string
}

variable "cidr_block" {
  type    = string
  default = "10.40.0.0/16"
}

variable "azs" {
  description = "Three AZs, one per Aurora instance (spec section 3). The NAT gateway sits in the first."
  type        = list(string)

  validation {
    condition     = length(var.azs) == 3
    error_message = "The setup needs exactly three AZs."
  }
}
