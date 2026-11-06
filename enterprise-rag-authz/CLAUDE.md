# Agent rules for Enterprise RAG Authz

Document Q&A for two fictional companies in one OpenSearch index. A user must never get an answer,
citation or error derived from a document outside their tenant and groups.

## The spec is the source of truth

`docs/SPEC.md` governs this project: access model, enforcement order, state machine and tests.
Change the spec first, then the code.

The spec is gitignored because it holds the unpublished article plan and results. If it is not on
disk, say so instead of guessing an access rule.

## Authorization rules

- The tenant and groups come only from a verified access token, never from a body, header or query
  string.
- All access rules live in `shared/erag/authz.py`, which imports nothing from AWS.
- The ACL goes in the hybrid query's top-level `filter`. Never use `post_filter` for it.
- Nothing disables the filter: no flag, no debug route. The recheck proof lives in the eval task.
- `recheck` runs before rerank, so no restricted text reaches the reranker or the model.
- `tenant-admin` manages documents and grants no read access.
- Anything malformed or missing is denied. Ingestion fails closed.

## Data handling

- Logs never contain prompts, answers or document text. Questions are logged as SHA-256 only.
- OpenSearch scores never reach the client.
- The article states only what a test run in spec section 11 produced.

## Layout

- `api/` is the FastAPI app, `functions/<name>/` is one Lambda each, `web/` is React, `infra/` is
  Terraform.
- Code used by both the API and a Lambda goes in `shared/erag/`. Never copy an access rule.
- Each member keeps its own tests in a `test/` folder beside it.

## Conventions

- Resource names: `erag-{env}-{name}`. One `dev` stage, `eu-central-1`.
- Python 3.13 with a `uv` workspace, `mypy --strict`, `ruff`. `boto3` and `opensearch-py`, no LangChain or
  LlamaIndex.
- React, TypeScript, Vite, TanStack Query, shadcn/ui, with pnpm.
- Terraform for all infrastructure, the Makefile as the command surface.
- No CI. `make check` is the gate.
- The stack costs money every hour it exists. Never run `terraform apply` without the author asking
  for it in that moment.
