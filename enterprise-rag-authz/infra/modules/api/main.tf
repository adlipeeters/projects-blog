# FastAPI on Fargate behind an internal ALB. The only way in is CloudFront's VPC origin.

locals {
  container_port = 8000
}

data "aws_caller_identity" "current" {}

# The prompt attack filter judges only the tagged question. Output filters cover the answer.
resource "aws_bedrock_guardrail" "this" {
  name                      = "${var.name_prefix}-answers"
  blocked_input_messaging   = "I can't help with that request."
  blocked_outputs_messaging = "I can't help with that request."

  content_policy_config {
    filters_config {
      type            = "PROMPT_ATTACK"
      input_strength  = "HIGH"
      output_strength = "NONE"
    }

    dynamic "filters_config" {
      for_each = toset(["HATE", "INSULTS", "SEXUAL", "VIOLENCE", "MISCONDUCT"])
      content {
        type            = filters_config.key
        input_strength  = "MEDIUM"
        output_strength = "MEDIUM"
      }
    }
  }
}

resource "aws_bedrock_guardrail_version" "this" {
  guardrail_arn = aws_bedrock_guardrail.this.guardrail_arn
  description   = "Deployed version"
}

resource "aws_ecr_repository" "this" {
  name                 = "${var.name_prefix}-api"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name_prefix}-api"
  retention_in_days = 14
}

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix
}

data "aws_iam_policy_document" "tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-api-execution"
  assume_role_policy = data.aws_iam_policy_document.tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-api-task"
  assume_role_policy = data.aws_iam_policy_document.tasks_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid = "Registry"
    actions = [
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
    ]
    resources = [var.registry_table_arn]
  }

  # A presigned POST carries the signer's permissions, so the task role needs PutObject.
  statement {
    sid       = "Documents"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.documents_bucket_arn}/*"]
  }

  statement {
    sid       = "Search"
    actions   = ["es:ESHttp*"]
    resources = ["${var.search_domain_arn}/*"]
  }

  statement {
    sid     = "Models"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.answer_model}",
      "arn:aws:bedrock:*::foundation-model/${trimprefix(var.answer_model, "eu.")}",
      "arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0",
      "arn:aws:bedrock:${var.region}::foundation-model/amazon.rerank-v1:0",
    ]
  }

  # Rerank takes no resource-level permission.
  statement {
    sid       = "Rerank"
    actions   = ["bedrock:Rerank"]
    resources = ["*"]
  }

  statement {
    sid       = "Guardrail"
    actions   = ["bedrock:ApplyGuardrail"]
    resources = [aws_bedrock_guardrail.this.guardrail_arn]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "api"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name         = "api"
    image        = "${aws_ecr_repository.this.repository_url}:latest"
    essential    = true
    portMappings = [{ containerPort = local.container_port }]
    environment = [
      { name = "AWS_REGION", value = var.region },
      { name = "COGNITO_ISSUER", value = var.cognito_issuer },
      { name = "COGNITO_CLIENT_IDS", value = join(",", var.cognito_client_ids) },
      { name = "REGISTRY_TABLE", value = var.registry_table_name },
      { name = "DOCUMENTS_BUCKET", value = var.documents_bucket_name },
      { name = "SEARCH_ENDPOINT", value = var.search_endpoint },
      { name = "ANSWER_MODEL", value = var.answer_model },
      { name = "GUARDRAIL_ID", value = aws_bedrock_guardrail.this.guardrail_id },
      { name = "GUARDRAIL_VERSION", value = aws_bedrock_guardrail_version.this.version },
      { name = "RERANK_MIN_SCORE", value = var.rerank_min_score },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "api"
      }
    }
  }])
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "Internal ALB"
  vpc_id      = var.vpc_id

  ingress {
    description     = "HTTP from CloudFront, which VPC origins reach from these ranges"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    description = "To the tasks"
    from_port   = local.container_port
    to_port     = local.container_port
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = var.app_sg_id
  referenced_security_group_id = aws_security_group.alb.id
  description                  = "From the ALB"
  from_port                    = local.container_port
  to_port                      = local.container_port
  ip_protocol                  = "tcp"
}

resource "aws_lb" "this" {
  name               = "${var.name_prefix}-api"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids
  idle_timeout       = 60
}

resource "aws_lb_target_group" "this" {
  name                 = "${var.name_prefix}-api"
  port                 = local.container_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30

  health_check {
    path                = "/health"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "this" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

resource "aws_ecs_service" "this" {
  name            = "api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [var.app_sg_id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = "api"
    container_port   = local.container_port
  }

  depends_on = [
    aws_iam_role_policy_attachment.execution,
    aws_lb_listener.this,
  ]
}
