# Enterprise RAG Authz: every command the project needs.
#
#   make              this list
#   make check        everything a change has to pass before it counts as done
#   make deploy       terraform apply. The stack costs money every hour it exists
#   make destroy      tear it all down
#   make m1-check     after a deploy: index, smoke test, demo accounts, token check
#
# Any variable can be overridden per call: make outputs ENV=dev

ENV ?= dev
REGION ?= eu-central-1
TF := terraform -chdir=infra/envs/$(ENV)
AWS_ENV = AWS_REGION=$(REGION) AWS_DEFAULT_REGION=$(REGION)

# Recursive (=) on purpose: `make help` must not call terraform.
USER_POOL_ID = $(shell $(TF) output -raw user_pool_id)
EVAL_CLIENT_ID = $(shell $(TF) output -raw eval_client_id)
SEARCH_ADMIN_FUNCTION = $(shell $(TF) output -raw search_admin_function)
API_URL = $(shell $(TF) output -raw url)
API_REPO = $(shell $(TF) output -raw api_repository_url)
INGEST_REPO = $(shell $(TF) output -raw ingest_repository_url)
EVAL_REPO = $(shell $(TF) output -raw eval_repository_url)

UV := uv run --all-packages

.DEFAULT_GOAL := help

##@ Getting around

help: ## Show this list
	@awk 'BEGIN {FS = ":.*?## "} /^##@/ {printf "\n%s\n", substr($$0, 5)} /^[a-zA-Z0-9_-]+:.*?## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""

##@ Checks

install: ## Install Python and web dependencies
	uv sync --all-packages
	pnpm --dir web install

format: ## Format Python and web code
	$(UV) ruff check --fix .
	$(UV) ruff format .
	pnpm --dir web format

lint: ## ruff, oxlint and prettier, no changes
	$(UV) ruff check .
	$(UV) ruff format --check .
	pnpm --dir web lint
	pnpm --dir web format:check

typecheck: ## mypy --strict and tsc
	$(UV) mypy
	pnpm --dir web typecheck

test: ## Unit tests, nothing deployed
	AWS_DEFAULT_REGION=$(REGION) $(UV) pytest
	pnpm --dir web test

web-build: ## Production build of the React app
	pnpm --dir web build

tf-check: ## terraform fmt and validate, no credentials or backend
	terraform fmt -check -recursive infra
	TF_DATA_DIR=.terraform-check $(TF) init -backend=false -input=false >/dev/null
	TF_DATA_DIR=.terraform-check $(TF) validate

check: lint typecheck test web-build tf-check ## Everything a change has to pass

##@ Infrastructure

build-search-admin: ## Package the search admin Lambda
	rm -rf build/search_admin build/search_admin.zip
	mkdir -p build/search_admin
	uv pip install --quiet --target build/search_admin --python-version 3.13 \
		--python-platform aarch64-manylinux2014 --only-binary :all: opensearch-py
	cp -R shared/erag build/search_admin/erag
	cp functions/search_admin/search_admin.py build/search_admin/
	cd build/search_admin && zip -qr ../search_admin.zip . -x '*/__pycache__/*'

tf-init: ## terraform init, after adding a module
	$(TF) init

plan: build-search-admin ## terraform plan
	$(TF) plan

deploy: build-search-admin ## terraform apply
	$(TF) apply

destroy: build-search-admin ## Tear everything down
	$(TF) destroy

outputs: ## Every terraform output
	$(TF) output

ecr: ## Create only the ECR repositories, so images exist before the services that use them
	$(TF) apply -target=module.api.aws_ecr_repository.this -target=module.ingest.aws_ecr_repository.this -target=module.eval_task.aws_ecr_repository.this

ecr-login: ## Log docker in to ECR
	aws ecr get-login-password --region $(REGION) | docker login --username AWS --password-stdin $$(echo $(API_REPO) | cut -d/ -f1)

requirements: ## Pin each image's dependencies from uv.lock
	mkdir -p build
	uv export --quiet --frozen --no-dev --no-emit-workspace --no-hashes --package erag-api -o build/requirements-api.txt
	uv export --quiet --frozen --no-dev --no-emit-workspace --no-hashes --package erag-ingest -o build/requirements-ingest.txt
	uv export --quiet --frozen --no-dev --no-emit-workspace --no-hashes --package erag -o build/requirements-eval.txt

push: requirements ecr-login ## Build and push all three arm64 images
	docker build --platform linux/arm64 --provenance=false -f api/Dockerfile -t $(API_REPO):latest .
	docker push $(API_REPO):latest
	docker build --platform linux/arm64 --provenance=false -f functions/ingest/Dockerfile -t $(INGEST_REPO):latest .
	docker push $(INGEST_REPO):latest
	docker build --platform linux/arm64 --provenance=false -f eval/internal/Dockerfile -t $(EVAL_REPO):latest .
	docker push $(EVAL_REPO):latest

redeploy: push ## Push new images and roll the API and the ingest Lambda onto them
	aws ecs update-service --cluster $$($(TF) output -raw ecs_cluster) --service $$($(TF) output -raw ecs_service) \
		--force-new-deployment --region $(REGION) --query 'service.serviceName' --output text
	aws lambda update-function-code --function-name $$($(TF) output -raw ingest_function) \
		--image-uri $(INGEST_REPO):latest --region $(REGION) --query 'FunctionName' --output text

##@ The web app

web-config: ## Write the config the app loads at start
	@printf '{"authority":"https://cognito-idp.%s.amazonaws.com/%s","clientId":"%s","loginUrl":"https://%s.auth.%s.amazoncognito.com"}\n' \
		$(REGION) $(USER_POOL_ID) $$($(TF) output -raw web_client_id) $$($(TF) output -raw login_domain) $(REGION) > web/public/config.json

web-dev: web-config ## Run the app on localhost:5173 against the deployed API
	API_URL=$(API_URL) pnpm --dir web dev

web-deploy: web-config web-build ## Build the app and publish it through CloudFront
	aws s3 sync web/dist s3://$$($(TF) output -raw web_bucket) --delete --region $(REGION)
	aws cloudfront create-invalidation --distribution-id $$($(TF) output -raw distribution_id) \
		--paths '/*' --query 'Invalidation.Status' --output text

##@ After a deploy

search-setup: ## Create the chunks index and the search pipeline
	$(AWS_ENV) SEARCH_ADMIN_FUNCTION=$(SEARCH_ADMIN_FUNCTION) $(UV) python scripts/invoke_search_admin.py setup

search-smoke: ## Prove the filtered hybrid query on a throwaway index
	$(AWS_ENV) SEARCH_ADMIN_FUNCTION=$(SEARCH_ADMIN_FUNCTION) $(UV) python scripts/invoke_search_admin.py smoke

seed-users: ## Create the demo accounts
	$(AWS_ENV) USER_POOL_ID=$(USER_POOL_ID) $(UV) python scripts/seed_users.py

check-tokens: ## Log in as every persona and check the access token claims
	$(AWS_ENV) USER_POOL_ID=$(USER_POOL_ID) EVAL_CLIENT_ID=$(EVAL_CLIENT_ID) $(UV) python scripts/check_tokens.py

m1-check: search-setup search-smoke seed-users check-tokens ## All of the above, the M1 done test

generate-corpus: ## Generate the fictional documents with Bedrock. Skips finished ones
	$(AWS_ENV) $(UV) python scripts/generate_corpus.py

seed: ## Upload corpus/ through the admin API and wait for INDEXED
	$(AWS_ENV) USER_POOL_ID=$(USER_POOL_ID) EVAL_CLIENT_ID=$(EVAL_CLIENT_ID) API_URL=$(API_URL) \
		$(UV) python scripts/seed_corpus.py

ask: ## Ask as a demo account: make ask AS=alderline-hr Q="What are the salary bands?"
	@$(AWS_ENV) USER_POOL_ID=$(USER_POOL_ID) EVAL_CLIENT_ID=$(EVAL_CLIENT_ID) API_URL=$(API_URL) \
		$(UV) python scripts/ask.py "$(AS)" "$(Q)"

EVAL_ENV = $(AWS_ENV) USER_POOL_ID=$(USER_POOL_ID) EVAL_CLIENT_ID=$(EVAL_CLIENT_ID) API_URL=$(API_URL) \
	API_LOG_GROUP=$$($(TF) output -raw api_log_group) INGEST_LOG_GROUP=/aws/lambda/$$($(TF) output -raw ingest_function) \
	PRE_TOKEN_LOG_GROUP=/aws/lambda/erag-$(ENV)-pre-token

eval-access: ## End-to-end access, spoofing, injection, log hygiene, limits. Takes several minutes
	$(EVAL_ENV) $(UV) pytest eval/test_access.py eval/test_spoofing.py eval/test_injection.py eval/test_hygiene_and_limits.py

eval-internal: ## Full access matrix and recheck proof, in a one-off task. Fires the recheck alarm on purpose
	$(AWS_ENV) ECS_CLUSTER=$$($(TF) output -raw ecs_cluster) EVAL_TASK_DEFINITION=$$($(TF) output -raw eval_task_definition) \
		PRIVATE_SUBNET_IDS=$$($(TF) output -raw private_subnet_ids) APP_SECURITY_GROUP=$$($(TF) output -raw app_security_group) \
		API_LOG_GROUP=$$($(TF) output -raw api_log_group) RECHECK_ALARM=$$($(TF) output -raw recheck_alarm) \
		$(UV) python scripts/run_internal_eval.py

eval-quality: ## Golden questions: hit rate, citations, not found. Writes results/
	$(EVAL_ENV) $(UV) python scripts/eval_quality.py

eval-summary: ## Timing, tokens and outcomes from the audit log. HOURS=24 by default
	$(AWS_ENV) API_LOG_GROUP=$$($(TF) output -raw api_log_group) $(UV) python scripts/summarize.py $(or $(HOURS),24)

eval-chat: ## Question path, against the deployed stack
	$(AWS_ENV) USER_POOL_ID=$(USER_POOL_ID) EVAL_CLIENT_ID=$(EVAL_CLIENT_ID) API_URL=$(API_URL) \
		$(UV) pytest eval/test_chat.py

eval-documents: ## Admin isolation, ingestion and deletion, against the deployed stack
	$(AWS_ENV) USER_POOL_ID=$(USER_POOL_ID) EVAL_CLIENT_ID=$(EVAL_CLIENT_ID) API_URL=$(API_URL) \
		SEARCH_ADMIN_FUNCTION=$(SEARCH_ADMIN_FUNCTION) DOCUMENTS_BUCKET=$$($(TF) output -raw documents_bucket) \
		INGEST_QUEUE_URL=$$($(TF) output -raw ingest_queue_url) $(UV) pytest eval/test_documents.py

.PHONY: help install format lint typecheck test web-build tf-check check build-search-admin tf-init \
	plan deploy destroy outputs search-setup search-smoke seed-users check-tokens m1-check ecr ecr-login requirements push \
	redeploy generate-corpus seed ask eval-chat eval-documents web-config web-dev web-deploy \
	eval-access eval-internal eval-quality eval-summary
