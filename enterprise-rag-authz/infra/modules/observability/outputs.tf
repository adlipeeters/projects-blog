output "recheck_alarm_name" {
  description = "Alarm the recheck proof expects to fire"
  value       = aws_cloudwatch_metric_alarm.recheck_dropped.alarm_name
}
