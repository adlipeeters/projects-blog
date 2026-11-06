# S3 to SQS to a container Lambda (spec section 7). Concurrency is capped on the event source
# mapping rather than with reserved concurrency, because this account's Lambda quota is 10 and
# reserving any of it is refused.

resource "aws_ecr_repository" "this" {
  name                 = "${var.name_prefix}-ingest"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = "${var.name_prefix}-ingest"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "vpc" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "this" {
  statement {
    sid       = "Registry"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [var.registry_table_arn]
  }

  statement {
    sid       = "Documents"
    actions   = ["s3:GetObject", "s3:DeleteObject"]
    resources = ["${var.documents_bucket_arn}/*"]
  }

  statement {
    sid       = "Queue"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [var.ingest_queue_arn]
  }

  statement {
    sid       = "Embeddings"
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"]
  }

  statement {
    sid       = "Search"
    actions   = ["es:ESHttp*"]
    resources = ["${var.search_domain_arn}/*"]
  }
}

resource "aws_iam_role_policy" "this" {
  name   = "ingest"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.this.json
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name_prefix}-ingest"
  retention_in_days = 14
}

resource "aws_lambda_function" "this" {
  function_name = "${var.name_prefix}-ingest"
  role          = aws_iam_role.this.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.this.repository_url}:latest"
  architectures = ["arm64"]
  timeout       = var.function_timeout
  memory_size   = 1024

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [var.app_sg_id]
  }

  environment {
    variables = {
      REGISTRY_TABLE   = var.registry_table_name
      DOCUMENTS_BUCKET = var.documents_bucket_name
      SEARCH_ENDPOINT  = var.search_endpoint
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.this,
    aws_iam_role_policy_attachment.vpc,
  ]
}

resource "aws_lambda_event_source_mapping" "this" {
  event_source_arn = var.ingest_queue_arn
  function_name    = aws_lambda_function.this.arn
  batch_size       = 1

  scaling_config {
    maximum_concurrency = 5
  }

  depends_on = [aws_iam_role_policy.this]
}
