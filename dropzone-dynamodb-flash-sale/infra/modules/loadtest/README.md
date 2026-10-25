# infra/modules/loadtest

Where the section 9 load harness runs: an ECR repository, an ECS cluster, and one arm64 Fargate
task definition whose task role may touch the commerce table and read the catalog, and nothing
else.

Idle, it costs nothing. A run is a couple of cents of task time. That is the whole reason the
experiment drives DynamoDB from a container instead of waiting on a Lambda concurrency increase:
the account's quota is 10 concurrent executions, and this test needs hundreds of simultaneous
writers to say anything about a hot partition.

The task runs in a default-VPC public subnet with a public IP, so there is no NAT gateway and no
VPC endpoint in the bill. Pass `subnet_ids` to run somewhere else.

`DYNAMODB_MAX_SOCKETS` must be at least the run's `--concurrency`. The SDK defaults to 50 sockets,
and a run with 400 buyers and 50 sockets measures the socket pool.

## A run

`make push`, `make run-a`, `make result`, `make verify`, then `make run-b`. What those do, if you
would rather type it out:

```bash
# 1. build and push
pnpm load:image
aws ecr get-login-password --region eu-central-1 \
  | docker login --username AWS --password-stdin "$(terraform -chdir=infra/envs/dev output -raw loadtest_ecr_repository_url | cut -d/ -f1)"
docker tag dropzone-load "$(terraform -chdir=infra/envs/dev output -raw loadtest_ecr_repository_url):latest"
docker push "$(terraform -chdir=infra/envs/dev output -raw loadtest_ecr_repository_url):latest"

# 2. seed run A: one bucket. This also sets the variant's stockBuckets, which is what the
#    allocator rotates over, and prints the timestamp to pass to verify-stock.
COMMERCE_TABLE=dropzone-dev-commerce CATALOG_TABLE=dropzone-dev-catalog \
  pnpm seed-stock -- --sku DROP-TEE-M-BLK --units 5000 --buckets 1

# 3. run it
eval "$(terraform -chdir=infra/envs/dev output -raw loadtest_run_task_command)"

# 4. read the summary and check the invariant
aws logs tail /aws/ecs/dropzone-dev-load --region eu-central-1 --since 10m | grep RESULT
COMMERCE_TABLE=dropzone-dev-commerce \
  pnpm verify-stock -- --sku DROP-TEE-M-BLK --units 5000 --since "<the timestamp seed-stock printed>"
```

Then repeat with `--buckets 10` for run B. Same image, same task size, same `--concurrency`.
