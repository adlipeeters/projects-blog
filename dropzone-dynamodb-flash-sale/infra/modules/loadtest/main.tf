# The load harness's home: an ECR repository, a cluster, and one arm64 Fargate task definition
# (spec section 9).
#
# None of it costs anything while idle. A run is a couple of cents of task time, which is why the
# experiment drives DynamoDB from a container rather than waiting on a Lambda concurrency increase.

data "aws_region" "current" {}

data "aws_vpc" "default" {
  count   = length(var.subnet_ids) == 0 ? 1 : 0
  default = true
}

data "aws_subnets" "default" {
  count = length(var.subnet_ids) == 0 ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default[0].id]
  }
}

locals {
  subnet_ids = length(var.subnet_ids) > 0 ? var.subnet_ids : data.aws_subnets.default[0].ids
  vpc_id     = length(var.subnet_ids) > 0 ? null : data.aws_vpc.default[0].id
  container  = "harness"
}

resource "aws_ecr_repository" "harness" {
  name                 = "${var.name_prefix}-load"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  tags                 = var.tags

  image_scanning_configuration {
    scan_on_push = false
  }
}

# One image per run at most, and the old ones are of no interest once their numbers are recorded.
resource "aws_ecr_lifecycle_policy" "harness" {
  repository = aws_ecr_repository.harness.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the three most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 3
        }
        action = { type = "expire" }
      }
    ]
  })
}

resource "aws_ecs_cluster" "harness" {
  name = "${var.name_prefix}-load"
  tags = var.tags
}

resource "aws_cloudwatch_log_group" "harness" {
  name              = "/aws/ecs/${var.name_prefix}-load"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "aws_iam_policy_document" "task_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Pulls the image and writes the log stream. Nothing to do with the table.
resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-load-execution"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# What the harness itself may do: the same writes create-hold and confirm-hold perform, and the
# same read-only access to the catalog. No index access, because neither path queries one.
data "aws_iam_policy_document" "harness" {
  statement {
    sid    = "HoldAndConfirmOnCommerce"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]

    resources = [var.commerce_table_arn]
  }

  statement {
    sid       = "ReadCatalogForPricing"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:BatchGetItem"]
    resources = [var.catalog_table_arn]
  }
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-load-task"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "task" {
  name   = "harness"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.harness.json
}

# Egress only. The task talks to DynamoDB and ECR over the internet from a public subnet, and
# nothing ever talks to it.
resource "aws_security_group" "harness" {
  name        = "${var.name_prefix}-load"
  description = "Load harness: outbound only."
  vpc_id      = local.vpc_id
  tags        = var.tags

  egress {
    description = "Anywhere: DynamoDB, ECR and CloudWatch are all public endpoints."
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_task_definition" "harness" {
  family                   = "${var.name_prefix}-load"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  tags                     = var.tags

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = local.container
      image     = "${aws_ecr_repository.harness.repository_url}:latest"
      essential = true
      command   = var.command

      environment = [
        { name = "COMMERCE_TABLE", value = var.commerce_table_name },
        { name = "CATALOG_TABLE", value = var.catalog_table_name },
        # At least the run's concurrency. The SDK's default of 50 would queue the rest.
        { name = "DYNAMODB_MAX_SOCKETS", value = tostring(var.max_sockets) },
        { name = "AWS_REGION", value = data.aws_region.current.region },
      ]

      # Fargate defaults to 1,024 open files. A run with 2,000 sockets in flight would fail with
      # EMFILE long before DynamoDB noticed it, and the failure would look like the table's fault.
      ulimits = [
        {
          name      = "nofile"
          softLimit = 65536
          hardLimit = 65536
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.harness.name
          "awslogs-region"        = data.aws_region.current.region
          "awslogs-stream-prefix" = "run"
        }
      }
    }
  ])
}
