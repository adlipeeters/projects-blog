# EventBridge Scheduler for the hold sweeper (spec section 7).
#
# The custom bus, its rules and the stream on-failure queues arrive with M4. This module starts
# with the one piece the flash sale needs: something that runs every minute and gives expired
# holds their stock back.

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "invoke_sweeper" {
  statement {
    sid       = "InvokeHoldSweeper"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [var.sweeper_function_arn]
  }
}

# Scheduler invokes through this role, so the function needs no resource-based policy.
resource "aws_iam_role" "scheduler" {
  name               = "${var.name_prefix}-hold-sweeper-schedule"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "invoke-hold-sweeper"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.invoke_sweeper.json
}

resource "aws_scheduler_schedule" "hold_sweeper" {
  name       = "${var.name_prefix}-hold-sweeper"
  group_name = "default"
  state      = var.enabled ? "ENABLED" : "DISABLED"

  # OFF, not a window: a sweeper that may run up to fifteen minutes late is not a sweeper.
  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = "UTC"

  target {
    arn      = var.sweeper_function_arn
    role_arn = aws_iam_role.scheduler.arn

    # No retries. The schedule fires again in a minute and the index still holds whatever was
    # missed, so retrying a failed run would only overlap the next one. Scheduler's default is 185
    # attempts over 24 hours, which for a per-minute job is a pile-up waiting to happen.
    retry_policy {
      maximum_retry_attempts       = 0
      maximum_event_age_in_seconds = 60
    }
  }
}
