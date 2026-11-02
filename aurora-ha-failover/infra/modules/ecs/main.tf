# The app tier (spec section 3): one image in ECR, one ECS cluster, and two services behind one
# public ALB. `web` serves the page and /api, `prober` runs the three heartbeat modes and serves
# /prober.

locals {
  container_port = 8080

  log_options = {
    awslogs-group  = aws_cloudwatch_log_group.app.name
    awslogs-region = var.region
  }

  db_environment = [
    for name, value in {
      AWS_REGION        = var.region
      PORT              = tostring(local.container_port)
      CLUSTER_ID        = var.db.cluster_id
      DB_NAME           = var.db.name
      DB_SECRET_ARN     = var.db.secret_arn
      WRITER_HOST       = var.db.writer_host
      READER_HOST       = var.db.reader_host
      PROXY_WRITER_HOST = var.db.proxy_writer_host
      PROXY_READER_HOST = var.db.proxy_reader_host
    } : { name = name, value = value } if value != null
  ]
}

# ---------------------------------------------------------------------------
# Image and logs
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "app" {
  name                 = var.name_prefix
  image_tag_mutability = "MUTABLE"

  # The repository goes with `make destroy`, images and all.
  force_delete = true
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.name_prefix}"
  retention_in_days = 7
}

# ---------------------------------------------------------------------------
# IAM
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by ECS itself: pull the image, write the logs.
resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Used by the app: read the DB secret, and look up which AZ each instance is in.
resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "ReadDbSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db.secret_arn]
  }

  # DescribeDBInstances with a cluster filter is authorised against every instance it could
  # return, so it needs the wildcard. It is read-only.
  statement {
    sid       = "DescribeInstances"
    actions   = ["rds:DescribeDBInstances"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "app"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# ---------------------------------------------------------------------------
# Load balancer
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "Public ALB, HTTP from one CIDR"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name_prefix}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from the allowed CIDR only"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = var.allowed_cidr
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the tasks"
  ip_protocol                  = "tcp"
  from_port                    = local.container_port
  to_port                      = local.container_port
  referenced_security_group_id = var.app_security_group_id
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = var.app_security_group_id
  description                  = "From the ALB"
  ip_protocol                  = "tcp"
  from_port                    = local.container_port
  to_port                      = local.container_port
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_lb" "this" {
  name               = var.name_prefix
  load_balancer_type = "application"
  internal           = false
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name_prefix}-web"
  port        = local.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  # Deployments of a test app do not need five minutes of draining.
  deregistration_delay = 5

  # /health never touches the database, so a failover does not drain the tasks.
  health_check {
    path                = "/health"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# ---------------------------------------------------------------------------
# ECS
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "this" {
  name = var.name_prefix
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name         = "web"
      image        = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential    = true
      portMappings = [{ containerPort = local.container_port, protocol = "tcp" }]
      environment  = local.db_environment

      logConfiguration = {
        logDriver = "awslogs"
        options   = merge(local.log_options, { awslogs-stream-prefix = "web" })
      }
    },
  ])
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.web_subnet_ids
    security_groups  = [var.app_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = local.container_port
  }

  health_check_grace_period_seconds = 30

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.http]
}

# ---------------------------------------------------------------------------
# Prober (spec section 5)
# ---------------------------------------------------------------------------

resource "aws_lb_target_group" "prober" {
  name                 = "${var.name_prefix}-prober"
  port                 = local.container_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 5

  # Answered from memory, so a failover cannot fail it.
  health_check {
    path                = "/prober/health"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "prober" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/prober/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.prober.arn
  }
}

# Same image as web, other entrypoint. Half a vCPU because the three modes share one event loop,
# and a busy loop would show up as latency in every lane at once.
resource "aws_ecs_task_definition" "prober" {
  family                   = "${var.name_prefix}-prober"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name         = "prober"
      image        = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential    = true
      command      = ["node", "dist/src/prober/main.js"]
      portMappings = [{ containerPort = local.container_port, protocol = "tcp" }]
      environment  = local.db_environment

      logConfiguration = {
        logDriver = "awslogs"
        options   = merge(local.log_options, { awslogs-stream-prefix = "prober" })
      }
    },
  ])
}

# One task only: two probers would each write their own run and halve nothing useful.
resource "aws_ecs_service" "prober" {
  name            = "prober"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.prober.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  # Replace, never overlap: a new prober starts before the old one stops otherwise.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets          = var.prober_subnet_ids
    security_groups  = [var.app_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.prober.arn
    container_name   = "prober"
    container_port   = local.container_port
  }

  health_check_grace_period_seconds = 30

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener_rule.prober]
}
