# Dropzone: every command the project needs, so none of them has to be remembered.
#
#   make              this list
#   make check        everything a change has to pass before it counts as done
#   make run-a        seed one bucket and start the Fargate load run
#
# Any variable can be overridden per call: make run-a UNITS=5000 CONCURRENCY=400

ENV ?= dev
REGION ?= eu-central-1
TF := terraform -chdir=infra/envs/$(ENV)

SKU ?= DROP-TEE-M-BLK
UNITS ?= 5000
CONCURRENCY ?= 400
DURATION ?= 180
LABEL ?= run

# Recursive (=) and not immediate (:=) on purpose: these shell out to terraform, and `make help`
# must neither pay for that nor fail on a checkout where the backend is not initialised yet.
COMMERCE_TABLE = $(shell $(TF) output -raw commerce_table_name)
CATALOG_TABLE = $(shell $(TF) output -raw catalog_table_name)
API = $(shell $(TF) output -raw api_endpoint)
ECR = $(shell $(TF) output -raw loadtest_ecr_repository_url)
LOAD_NETWORK = $(shell $(TF) output -raw loadtest_network_configuration)
LOAD_LOGS = $(shell $(TF) output -raw loadtest_log_group)
TABLES = COMMERCE_TABLE=$(COMMERCE_TABLE) CATALOG_TABLE=$(CATALOG_TABLE)

# Written by the seed targets and read by `make verify`: the seed's timestamp on line one, the
# units on line two. Seeding overwrites `available` rather than adding to it, so the invariant only
# holds for orders placed after the seed, and `make verify` should not need either value repeated.
SEED_STAMP := .last-seed
SEED_LOG := .last-seed.log

.DEFAULT_GOAL := help

##@ Getting around

help: ## Show this list
	@awk 'BEGIN {FS = ":.*?## "} /^##@/ {printf "\n%s\n", substr($$0, 5)} /^[a-zA-Z0-9_-]+:.*?## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""

##@ Checks

install: ## Install dependencies
	pnpm install

typecheck: ## tsc --noEmit
	pnpm typecheck

lint: ## eslint
	pnpm lint

format: ## Rewrite with prettier
	pnpm format

test-unit: ## Unit tests, no Docker needed
	pnpm test:unit

test-integration: ## Integration tests against DynamoDB Local (needs Docker)
	pnpm test:integration

test: test-unit test-integration ## Both test suites

check: typecheck lint test-unit ## What a change has to pass: types, lint, format, unit tests
	pnpm format:check
	$(TF) validate
	terraform fmt -check -recursive infra

##@ Deploy

build: ## Bundle one zip per handler
	pnpm build

plan: build ## terraform plan
	$(TF) plan

deploy: build ## Build and terraform apply
	$(TF) apply

tf-init: ## terraform init, after adding a module
	$(TF) init

outputs: ## Every terraform output
	$(TF) output

##@ Data

seed: ## Seed the catalog: 200 products plus the drop
	$(TABLES) pnpm seed

seed-a: ## Seed run A: UNITS units in ONE bucket, and set the variant to match
	@rm -f $(SEED_STAMP)
	$(TABLES) pnpm seed-stock -- --sku $(SKU) --units $(UNITS) --buckets 1 > $(SEED_LOG) 2>&1 || { cat $(SEED_LOG); rm -f $(SEED_LOG); exit 1; }
	@cat $(SEED_LOG)
	@awk '/^Seeded at /{print $$3}' $(SEED_LOG) > $(SEED_STAMP)
	@grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' $(SEED_STAMP) || { echo "the seed printed no timestamp; refusing to leave a half-written $(SEED_STAMP)"; rm -f $(SEED_STAMP); exit 1; }
	@echo "$(UNITS)" >> $(SEED_STAMP)
	@rm -f $(SEED_LOG)
	@echo "saved for make verify: $$(sed -n 1p $(SEED_STAMP)), $$(sed -n 2p $(SEED_STAMP)) units"

seed-b: ## Seed run B: UNITS units across TEN buckets, and set the variant to match
	@rm -f $(SEED_STAMP)
	$(TABLES) pnpm seed-stock -- --sku $(SKU) --units $(UNITS) --buckets 10 > $(SEED_LOG) 2>&1 || { cat $(SEED_LOG); rm -f $(SEED_LOG); exit 1; }
	@cat $(SEED_LOG)
	@awk '/^Seeded at /{print $$3}' $(SEED_LOG) > $(SEED_STAMP)
	@grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' $(SEED_STAMP) || { echo "the seed printed no timestamp; refusing to leave a half-written $(SEED_STAMP)"; rm -f $(SEED_STAMP); exit 1; }
	@echo "$(UNITS)" >> $(SEED_STAMP)
	@rm -f $(SEED_LOG)
	@echo "saved for make verify: $$(sed -n 1p $(SEED_STAMP)), $$(sed -n 2p $(SEED_STAMP)) units"

stock: ## Print the sku's buckets and their sum
	$(TABLES) pnpm stock-report -- --sku $(SKU)

verify: ## Check the invariant for the last seeding, using its own units and cutoff
	@test -f $(SEED_STAMP) || { echo "no $(SEED_STAMP) yet: run make seed-a or make seed-b first"; exit 1; }
	@grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' $(SEED_STAMP) || { echo "$(SEED_STAMP) does not start with a timestamp; re-run make seed-a or make seed-b"; exit 1; }
	COMMERCE_TABLE=$(COMMERCE_TABLE) pnpm verify-stock -- --sku $(SKU) --units $$(sed -n 2p $(SEED_STAMP)) --since $$(sed -n 1p $(SEED_STAMP))

reset-catalog: ## Remove the seeded catalog items
	$(TABLES) pnpm reset-catalog

##@ The load run

load-local: ## Run the harness from here. Checks the harness, never the latency
	$(TABLES) DYNAMODB_MAX_SOCKETS=20 pnpm load -- --sku $(SKU) --concurrency 4 --duration 20 --max-attempts 8 --label local

image: ## Build the arm64 harness image
	pnpm load:image

ecr-login: ## Log docker in to ECR
	aws ecr get-login-password --region $(REGION) | docker login --username AWS --password-stdin $$(echo $(ECR) | cut -d/ -f1)

push: image ecr-login ## Build, tag and push the harness image
	docker tag dropzone-load $(ECR):latest
	docker push $(ECR):latest

run: ## Start one Fargate run with the current LABEL, CONCURRENCY and DURATION
	@aws ecs run-task --cluster dropzone-$(ENV)-load --task-definition dropzone-$(ENV)-load --launch-type FARGATE --region $(REGION) --network-configuration "$(LOAD_NETWORK)" --overrides '{"containerOverrides":[{"name":"harness","command":["--sku","$(SKU)","--concurrency","$(CONCURRENCY)","--duration","$(DURATION)","--label","$(LABEL)"]}]}' --query 'tasks[0].taskArn' --output text | awk -F/ '{print "started " $$NF}'
	@echo "follow it with: make logs"

run-a: seed-a ## Run A end to end: one bucket, then the Fargate run
	$(MAKE) run LABEL=runA

run-b: seed-b ## Run B end to end: ten buckets, then the Fargate run
	$(MAKE) run LABEL=runB

##@ Reading the results

logs: ## Follow the harness log group
	aws logs tail $(LOAD_LOGS) --region $(REGION) --since 15m --follow

result: ## The last run's summary line
	aws logs tail $(LOAD_LOGS) --region $(REGION) --since 1h --format short | grep RESULT | tail -1

latency: ## Server-side TransactWriteItems latency, which does not depend on where the client sat
	aws cloudwatch get-metric-statistics --namespace AWS/DynamoDB --metric-name SuccessfulRequestLatency --dimensions Name=TableName,Value=$(COMMERCE_TABLE) Name=Operation,Value=TransactWriteItems --start-time "$$(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ)" --end-time "$$(date -u +%Y-%m-%dT%H:%M:%SZ)" --period 60 --statistics Average Maximum --region $(REGION)

throttles: ## Write throttles on the commerce table and its indexes
	aws cloudwatch get-metric-statistics --namespace AWS/DynamoDB --metric-name WriteThrottleEvents --dimensions Name=TableName,Value=$(COMMERCE_TABLE) --start-time "$$(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ)" --end-time "$$(date -u +%Y-%m-%dT%H:%M:%SZ)" --period 60 --statistics Sum --region $(REGION)

sweeper: ## Follow the hold sweeper's log
	aws logs tail /aws/lambda/dropzone-$(ENV)-hold-sweeper --region $(REGION) --since 10m --follow

api: ## Print the API base URL
	@echo $(API)

api-stock: ## Ask the deployed API for the sku's stock
	curl -s $(API)skus/$(SKU)/stock
	@echo ""

.PHONY: help install typecheck lint format test test-unit test-integration check build plan \
        deploy tf-init outputs seed seed-a seed-b stock verify reset-catalog load-local image \
        ecr-login push run run-a run-b logs result latency throttles sweeper api api-stock
