# Aurora HA Failover: every command the project needs.
#
#   make              this list
#   make check        everything a change has to pass before it counts as done
#   make up           first deploy: the ECR repository, the image, then everything else
#   make status       which instance is the writer right now, and where each one sits
#   make s1           one run of scenario S1, dumped to results/ (LABEL=dry for a rehearsal)
#
# Any variable can be overridden per call: make status ENV=dev

ENV ?= dev
REGION ?= eu-central-1
TF := terraform -chdir=infra/envs/$(ENV)
CLUSTER := afl-$(ENV)
IMAGE := afl

# Recursive (=) and not immediate (:=) on purpose: `make help` must not call out to the network or
# to terraform. The ALB admits one /32, your current public IP, so a new network means a re-apply.
MY_CIDR = $(shell curl -fsS https://checkip.amazonaws.com)/32
TF_VARS = -var allowed_cidr=$(MY_CIDR)
ECR = $(shell $(TF) output -raw ecr_repository_url)
ECS_CLUSTER = $(shell $(TF) output -raw ecs_cluster_name)
LOG_GROUP = $(shell $(TF) output -raw log_group_name)
PAGE_URL = $(shell $(TF) output -raw url)
SCENARIO = PAGE_URL=$(PAGE_URL) CLUSTER_ID=$(CLUSTER) AWS_REGION=$(REGION) pnpm scenario --scenario
LABEL_ARG = $(if $(LABEL),--label $(LABEL))

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

test: ## Unit tests for the summary metrics
	pnpm test

check: typecheck lint test ## What a change has to pass: types, lint, tests, format, terraform
	pnpm format:check
	$(TF) validate
	terraform fmt -check -recursive infra

##@ Infrastructure

tf-init: ## terraform init, after adding a module
	$(TF) init

plan: ## terraform plan
	$(TF) plan $(TF_VARS)

deploy: ## terraform apply
	$(TF) apply $(TF_VARS)

ecr: ## Create only the ECR repository, so the first image can be pushed before the service exists
	$(TF) apply $(TF_VARS) -target=module.ecs.aws_ecr_repository.app

up: ecr push deploy ## First deploy: repository, image, then everything else

restore: ## Re-create an instance deleted by scenario S3
	$(TF) apply $(TF_VARS)

destroy: ## Tear everything down at the end of the test day
	$(TF) destroy $(TF_VARS)

outputs: ## Every terraform output
	$(TF) output

##@ The app

image: ## Build the arm64 image
	docker build --platform linux/arm64 -t $(IMAGE) .

ecr-login: ## Log docker in to ECR
	aws ecr get-login-password --region $(REGION) | docker login --username AWS --password-stdin $$(echo $(ECR) | cut -d/ -f1)

push: image ecr-login ## Build, tag and push the image
	docker tag $(IMAGE) $(ECR):latest
	docker push $(ECR):latest

redeploy: push ## Push a new image and roll both services onto it
	@for service in web prober; do \
		aws ecs update-service --cluster $(ECS_CLUSTER) --service $$service --force-new-deployment --region $(REGION) \
			--query 'service.serviceName' --output text; \
	done

url: ## Print the page URL
	@$(TF) output -raw url
	@echo ""

health: ## The prober's lanes: last sample, ticks in flight
	@curl -fsS $$($(TF) output -raw url)/prober/health | python3 -m json.tool

logs: ## Follow the app's log group
	aws logs tail $(LOG_GROUP) --region $(REGION) --since 15m --follow

##@ The cluster

status: ## Writer, readers, AZ, failover tier and state of every instance
	@aws rds describe-db-clusters --db-cluster-identifier $(CLUSTER) --region $(REGION) \
		--query 'DBClusters[0].[Status, DBClusterMembers[?IsClusterWriter].DBInstanceIdentifier | [0]]' \
		--output text | awk '{print "cluster " $$1 ", writer " $$2}'
	@aws rds describe-db-instances --filters Name=db-cluster-id,Values=$(CLUSTER) --region $(REGION) \
		--query 'DBInstances[].[DBInstanceIdentifier, AvailabilityZone, PromotionTier, DBInstanceStatus]' \
		--output table

events: ## Cluster and instance events from the last hour
	aws rds describe-events --source-type db-cluster --source-identifier $(CLUSTER) --duration 60 --region $(REGION) \
		--query 'Events[].[Date, Message]' --output text
	aws rds describe-events --source-type db-instance --duration 60 --region $(REGION) \
		--query "Events[?starts_with(SourceIdentifier, '$(CLUSTER)-')].[Date, SourceIdentifier, Message]" --output text

##@ Breaking it (spec section 7)

s1: ## Planned failover: failover-db-cluster
	$(SCENARIO) s1 $(LABEL_ARG)

s2: ## Writer reboot, no failover: reboot-db-instance on the writer
	$(SCENARIO) s2 $(LABEL_ARG)

s3: ## Writer deleted: delete-db-instance on the writer. Run make restore afterwards
	$(SCENARIO) s3 $(LABEL_ARG)

s4: ## Reader lost: reboot-db-instance on the tier-1 reader, no failover
	$(SCENARIO) s4 $(LABEL_ARG)

summary: ## Every run in results/, and the median and range table for the spec
	pnpm summarize

.PHONY: help install typecheck lint format test check tf-init plan deploy ecr up restore destroy outputs \
        image ecr-login push redeploy url health logs status events s1 s2 s3 s4 summary
