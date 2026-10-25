output "hold_sweeper_schedule_name" {
  value = aws_scheduler_schedule.hold_sweeper.name
}

output "hold_sweeper_schedule_arn" {
  value = aws_scheduler_schedule.hold_sweeper.arn
}

output "scheduler_role_arn" {
  value = aws_iam_role.scheduler.arn
}
