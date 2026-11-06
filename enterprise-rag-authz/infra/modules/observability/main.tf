# Metrics come from the audit records through metric filters, so the question path makes no extra
# API call and the numbers can't disagree with the audit log. Alarms change state without notifying
# anyone, a listed shortcut (spec section 13).

locals {
  namespace = "ERAG/${var.name_prefix}"

  api_metrics = {
    RecheckDropped   = { pattern = "{ ($.audit = \"question\") && ($.dropped > 0) }", value = "$.dropped" }
    GuardrailBlocked = { pattern = "{ $.guardrail_action = \"INTERVENED\" }", value = "1" }
    RateLimited      = { pattern = "{ $.audit = \"rate_limited\" }", value = "1" }
    TimeToFirstToken = { pattern = "{ $.time_to_first_token_ms > 0 }", value = "$.time_to_first_token_ms" }
    InputTokens      = { pattern = "{ $.input_tokens > 0 }", value = "$.input_tokens" }
    OutputTokens     = { pattern = "{ $.output_tokens > 0 }", value = "$.output_tokens" }
  }
}

resource "aws_cloudwatch_log_metric_filter" "api" {
  for_each = local.api_metrics

  name           = each.key
  log_group_name = var.api_log_group_name
  pattern        = each.value.pattern

  metric_transformation {
    name      = each.key
    namespace = local.namespace
    value     = each.value.value
    unit      = each.key == "TimeToFirstToken" ? "Milliseconds" : "Count"
  }
}

# The Lambda runtime prefixes each log line, so this matches terms rather than JSON fields.
resource "aws_cloudwatch_log_metric_filter" "ingest_failed" {
  name           = "IngestFailed"
  log_group_name = var.ingest_log_group_name
  pattern        = "\"failed\" \"reason\""

  metric_transformation {
    name      = "IngestFailed"
    namespace = local.namespace
    value     = "1"
    unit      = "Count"
  }
}

# Should never fire outside the recheck proof: it means the filter and the data disagree.
resource "aws_cloudwatch_metric_alarm" "recheck_dropped" {
  alarm_name          = "${var.name_prefix}-recheck-dropped"
  alarm_description   = "A chunk passed the OpenSearch filter and failed the recheck"
  namespace           = local.namespace
  metric_name         = "RecheckDropped"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  depends_on = [aws_cloudwatch_log_metric_filter.api]
}

resource "aws_cloudwatch_metric_alarm" "ingest_dlq" {
  alarm_name          = "${var.name_prefix}-ingest-dlq"
  alarm_description   = "A document failed every ingestion attempt"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = var.ingest_dlq_name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name_prefix}-api-5xx"
  alarm_description   = "The API is returning server errors"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = var.alb_arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
}
