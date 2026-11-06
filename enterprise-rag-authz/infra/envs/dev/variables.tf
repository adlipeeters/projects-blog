variable "env" {
  description = "Stage name, used in resource names"
  type        = string
  default     = "dev"
}

variable "region" {
  description = "AWS Region"
  type        = string
  default     = "eu-central-1"
}

variable "azs" {
  description = "Two AZs: the ALB needs two, and the single OpenSearch node sits in the first"
  type        = list(string)
  default     = ["eu-central-1a", "eu-central-1b"]
}

variable "search_admin_zip" {
  description = "Package built by make build-search-admin"
  type        = string
  default     = "../../../build/search_admin.zip"
}

variable "web_callback_urls" {
  description = "Where Cognito may send the browser after login, besides CloudFront"
  type        = list(string)
  default     = ["http://localhost:5173/"]
}

variable "rerank_min_score" {
  description = "Below this rerank score, the API answers not found without calling the model"
  type        = string
  default     = "0.005"
}
