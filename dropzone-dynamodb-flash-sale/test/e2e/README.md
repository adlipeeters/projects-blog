# test/e2e

Against the deployed `dev` stage, so these need AWS credentials and are opt-in.

Covers what DynamoDB Local cannot: a test EventBridge rule copies events to an SQS queue the
tests read; a cart written in `us-east-1` becomes readable in `eu-central-1`; the sweeper releases
an expired hold within two minutes.
