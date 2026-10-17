# infra/bootstrap

Creates the S3 bucket that holds Terraform state for every stack in this project. Applied once,
by hand, before `infra/envs/dev` can be initialised, because a backend cannot keep its state in a
bucket that does not exist yet.

```bash
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply
```

The first apply writes state to a local file. Immediately afterwards, `backend.tf` points this
stack at the bucket it just created and the state is migrated into it, so no stack keeps its state
on one laptop:

```bash
terraform -chdir=infra/bootstrap init -migrate-state
```

Locking is the S3 native lockfile (`use_lockfile`), added in Terraform 1.10. There is no DynamoDB
lock table, which is a pleasant irony for this project.

Infrastructure is applied from a laptop, so there is no CI role and no GitHub OIDC provider here.
