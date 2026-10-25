# infra/modules/events

The custom bus `dropzone-{env}` per region, its rules and targets, the
`aws_scheduler_schedule` at `rate(1 minute)` for the reservation sweeper, and the SQS DLQs and
stream on-failure queues.

Built so far: the hold sweeper's schedule and the role Scheduler invokes it through. The bus, the
rules and the on-failure queues arrive with M4, when there are stream consumers to feed.

Every stream consumer's event source mapping uses `starting_position = "LATEST"`,
`batch_size = 100`, `maximum_batching_window_in_seconds = 1`,
`function_response_types = ["ReportBatchItemFailures"]`, `bisect_batch_on_function_error = true`,
`maximum_retry_attempts = 5`, `maximum_record_age_in_seconds = 3600`, an `on_failure`
destination, and the filters in spec section 12.
