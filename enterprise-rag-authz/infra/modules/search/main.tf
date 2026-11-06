# A managed domain in the VPC, one node, IAM access only (spec section 6). No fine-grained access
# control: the app is the only client, and it can't be turned off once enabled.

data "aws_caller_identity" "current" {}

locals {
  domain_name = var.name_prefix
  domain_arn  = "arn:aws:es:${var.region}:${data.aws_caller_identity.current.account_id}:domain/${local.domain_name}"
}

# OpenSearch needs this role to place network interfaces in the VPC. Only the console creates it
# automatically.
resource "aws_iam_service_linked_role" "opensearch" {
  aws_service_name = "opensearchservice.amazonaws.com"
}

# CreateDomain rejects a role created seconds earlier, because IAM hasn't propagated it yet.
resource "time_sleep" "service_linked_role" {
  create_duration = "30s"
  depends_on      = [aws_iam_service_linked_role.opensearch]
}

resource "aws_opensearch_domain" "this" {
  domain_name    = local.domain_name
  engine_version = var.engine_version

  cluster_config {
    instance_type          = var.instance_type
    instance_count         = 1
    zone_awareness_enabled = false
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = 20
  }

  vpc_options {
    subnet_ids         = [var.subnet_id]
    security_group_ids = [var.search_sg_id]
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-PFS-2023-10"
  }

  auto_tune_options {
    desired_state       = "DISABLED"
    rollback_on_disable = "NO_ROLLBACK"
  }

  depends_on = [time_sleep.service_linked_role]
}

# The policy rejects roles created seconds earlier, for the same IAM propagation reason.
resource "time_sleep" "client_roles" {
  create_duration = "30s"
  triggers        = { roles = join(",", var.client_role_arns) }
}

resource "aws_opensearch_domain_policy" "this" {
  domain_name = aws_opensearch_domain.this.domain_name

  depends_on = [time_sleep.client_roles]

  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = concat([aws_iam_role.admin.arn], var.client_role_arns) }
      Action    = "es:ESHttp*"
      Resource  = "${local.domain_arn}/*"
    }]
  })
}

# The domain has no route from a laptop, so index setup and the smoke test run in this Lambda.
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "admin" {
  name               = "${var.name_prefix}-search-admin"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "admin_vpc" {
  role       = aws_iam_role.admin.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "admin" {
  statement {
    actions   = ["es:ESHttp*"]
    resources = ["${local.domain_arn}/*"]
  }
}

resource "aws_iam_role_policy" "admin" {
  name   = "search"
  role   = aws_iam_role.admin.id
  policy = data.aws_iam_policy_document.admin.json
}

resource "aws_cloudwatch_log_group" "admin" {
  name              = "/aws/lambda/${var.name_prefix}-search-admin"
  retention_in_days = 14
}

resource "aws_lambda_function" "admin" {
  function_name    = "${var.name_prefix}-search-admin"
  role             = aws_iam_role.admin.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "search_admin.handler"
  filename         = var.search_admin_zip
  source_code_hash = filebase64sha256(var.search_admin_zip)
  timeout          = 120
  memory_size      = 256

  vpc_config {
    subnet_ids         = var.lambda_subnets
    security_group_ids = [var.app_sg_id]
  }

  environment {
    variables = {
      SEARCH_ENDPOINT = aws_opensearch_domain.this.endpoint
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.admin,
    aws_iam_role_policy_attachment.admin_vpc,
  ]
}
