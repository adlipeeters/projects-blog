# A one-off task with its own image and its own role. The access matrix and the recheck proof run
# searches a real request could never make, so none of this code ships in the API image.

resource "aws_ecr_repository" "this" {
  name                 = "${var.name_prefix}-eval"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-eval-task"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "Search"
    actions   = ["es:ESHttpGet", "es:ESHttpPost"]
    resources = ["${var.search_domain_arn}/*"]
  }

  statement {
    sid       = "Embeddings"
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:${var.region}::foundation-model/amazon.titan-embed-text-v2:0"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "eval"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name_prefix}-eval"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "eval"
    image     = "${aws_ecr_repository.this.repository_url}:latest"
    essential = true
    environment = [
      { name = "AWS_REGION", value = var.region },
      { name = "SEARCH_ENDPOINT", value = var.search_endpoint },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = var.log_group_name
        awslogs-region        = var.region
        awslogs-stream-prefix = "eval"
      }
    }
  }])
}
