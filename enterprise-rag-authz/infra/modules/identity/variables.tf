variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "callback_urls" {
  description = "Where Cognito may send the browser after login and logout"
  type        = list(string)
}
