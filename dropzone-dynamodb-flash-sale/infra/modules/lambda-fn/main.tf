# Reusable function: bundle, role, log group, function. Every handler in the project goes through
# this module, so defaults and least-privilege wiring are decided once.

locals {
  function_name = "${var.name_prefix}-${var.name}"
  log_group     = "/aws/lambda/${var.name_prefix}-${var.name}"
}

# The bundle is whatever scripts/build.mjs produced. Terraform zips it, so the source hash and the
# deployed artifact can never disagree.
data "archive_file" "bundle" {
  type        = "zip"
  source_dir  = var.dist_dir
  output_path = "${path.root}/.terraform/build/${var.name}.zip"
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = "${local.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

# Logs and tracing are the only permissions the module grants by itself. Everything else arrives as
# policy_json from the caller, which names the exact tables and indexes the function touches.
data "aws_iam_policy_document" "baseline" {
  statement {
    sid    = "WriteOwnLogs"
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }

  statement {
    sid    = "WriteTraces"
    effect = "Allow"

    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
    ]

    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "baseline" {
  name   = "baseline"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.baseline.json
}

resource "aws_iam_role_policy" "function" {
  count = var.policy_json == null ? 0 : 1

  name   = "function"
  role   = aws_iam_role.this.id
  policy = var.policy_json
}

# Created here rather than left to Lambda, so retention is set from the start and the role's log
# permissions can be scoped to this one group.
resource "aws_cloudwatch_log_group" "this" {
  name              = local.log_group
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_lambda_function" "this" {
  function_name = local.function_name
  description   = var.description
  role          = aws_iam_role.this.arn

  filename         = data.archive_file.bundle.output_path
  source_code_hash = data.archive_file.bundle.output_base64sha256

  handler       = var.handler
  runtime       = var.runtime
  architectures = ["arm64"]
  memory_size   = var.memory_size
  timeout       = var.timeout

  reserved_concurrent_executions = var.reserved_concurrency

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = merge(
      {
        STAGE           = var.stage
        SERVICE_NAME    = var.name_prefix
        SERVICE_VERSION = var.service_version

        POWERTOOLS_SERVICE_NAME      = var.name_prefix
        POWERTOOLS_METRICS_NAMESPACE = "Dropzone"
        POWERTOOLS_LOG_LEVEL         = "INFO"

        # The SDK is bundled, so nothing needs the runtime's own copy.
        AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
      },
      var.environment,
    )
  }

  tags = var.tags

  depends_on = [
    aws_cloudwatch_log_group.this,
    aws_iam_role_policy.baseline,
  ]
}
