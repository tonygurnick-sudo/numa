# Deployment Pipelines

How a commit to the Numa repo becomes an image that becomes a deployed client stack. This doc covers the end-to-end pipeline: GitLab CI → ECR → Customer Success Portal → Step Functions → ECS Fargate → CDKTF apply.

If you're trying to do one specific thing (deploy main, build a dev image, debug a failed deploy), jump to [Recipes](#recipes) and [Troubleshooting](#troubleshooting). Otherwise read top to bottom.

---

## TL;DR

- **Two ECR image channels** — prod (`numa-deploy`) and dev (`numa-deploy-dev`), both in the `arcanum-prod-images` AWS account (`826326270637`), region `ap-southeast-2`.
- **Prod images** are built **automatically** from every push to `main`. Tag = `:${SHA}`. No `:latest` tag is pushed.
- **Dev images** are built **manually** by clicking a button on the `dev` branch pipeline, or on any `dev-image/*` branch pipeline. Tag = `:${SHA}`. They never get to `main`.
- **The Customer Success Portal** lists both repos as separate tabs and lets you deploy any image to any client. A foot-gun guard requires typing the client name when deploying a Dev image to a non-`devInstance` client.
- **A "deploy"** is a Step Functions execution that runs an ECS Fargate task using the chosen image. The container's job is to run `cdktf deploy numa-<client>`.

---

## Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────────┐
│  GitLab repo: arcanumai/numa                                         │
│  - main         → auto build → numa-deploy:${SHA}                    │
│  - dev          → manual button → numa-deploy-dev:${SHA}             │
│  - dev-image/*  → manual button → numa-deploy-dev:${SHA}             │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ docker push (assumes arcanum-ci role)
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  arcanum-prod-images (AWS account 826326270637, ap-southeast-2)     │
│  ECR:                                                                │
│    numa-deploy                (IMMUTABLE_WITH_EXCLUSION{latest})    │
│    numa-deploy-dev            (IMMUTABLE)                           │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ ECR pull (deploy task assumes pull rights)
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  arcanum-q-deployer-prod (AWS account 207567759910, us-east-1)      │
│  Customer Success Portal (React SPA):                                │
│    - Lists images via ecr:DescribeImages                            │
│    - User picks: client + channel + image + label → click Deploy     │
│  Step Functions: NumaPortalDeployment                                │
│    - Acquires per-client lock in DynamoDB                           │
│    - Calls portal-deploy-assume-backend Lambda for tf state creds    │
│    - Registers ECS task definition (image = picked)                  │
│    - Runs Fargate task: yarn cdktf deploy numa-<client>              │
│  DynamoDB:                                                           │
│    numa-portal-deployments       (history, GSI clientName-index)    │
│    numa-portal-image-metadata    (custom names per image)           │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ assume admin-delegated-access in target
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Client AWS account (one per Numa instance)                         │
│  CDKTF deploys numa-<client> stack to that account                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## The two image channels

|                  | Prod                                                   | Dev                                                                                            |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| ECR repo         | `numa-deploy`                                          | `numa-deploy-dev`                                                                              |
| Built from       | `main` (auto)                                          | `dev` and `dev-image/*` (manual button)                                                        |
| Tag scheme       | `:${SHA}` (and the legacy `:latest`, being phased out) | `:${SHA}` only — never `:latest`                                                               |
| Mutability       | `IMMUTABLE_WITH_EXCLUSION{latest}`                     | `IMMUTABLE` (every tag is locked)                                                              |
| Used to deploy   | Customer stacks                                        | Test stacks (typically `arcanum-demo`, `nd-labs`, etc.)                                        |
| Repo policy file | Bootstrapped manually (no in-repo source)              | [tools/aws/numa-deploy-dev-repo-policy.json](../../tools/aws/numa-deploy-dev-repo-policy.json) |

**Why two repos and not one with channel-suffixed tags?** Cleaner IAM (the prod repo's policy is locked-down), and it lets us use ECR mutability flags differently per channel. It also makes the Customer Success Portal UX trivial — one tab per repo.

**Why no `:latest` on dev?** A moving `:latest` tag breaks the portal's image-rename feature, where Nathan and the team apply human-readable names to specific image digests. If `:latest` moves under your feet, the rename you applied yesterday is now associated with whatever last got pushed today.

---

## GitLab CI pipeline

Source: [.gitlab-ci.yml](../../.gitlab-ci.yml). Includes templates from `arcanumai/ci`.

### Stages

```
.pre  →  setup  →  check  →  package  →  image-build  →  deploy  →  deploy:customer
```

- **`.pre`** — currently only the `deploy-dev-gate` manual button on the `dev` branch.
- **`setup`** / **`check`** — auth, lint, type, unit tests. Runs on all pipelines.
- **`package`** — builds and zips the artifacts that go into the deployment container:
  - Python lambda zips (~60 of them, one per `lambdas/python/<name>`)
  - Node lambda bundles (~50, including `lib/client-config-node`, etc.)
  - `numa-workspace-agent` ARM64 container TAR
  - `browser-lambda` ARM64 container TAR
- **`image-build`** — builds the deployment container itself (combines all package artifacts via [infra/container/Dockerfile](../../infra/container/Dockerfile)), tags `:${SHA}`, pushes to ECR. Two variants: prod (`build-deployment-container`) and dev (`build-deployment-container-dev`).
- **`deploy`** — for the `dev` branch path, deploys to `arcanum-demo` after manual click. For `main`, auto-deploys to `arcanum-demo`.
- **`deploy:customer`** — manual buttons per client; only on `main`. Used for production customer rollouts.

### Branch behavior matrix

| Branch        | Checks                                                       | Package | Image build                | Auto deploy demo        |
| ------------- | ------------------------------------------------------------ | ------- | -------------------------- | ----------------------- |
| `main`        | auto                                                         | auto    | auto → `numa-deploy`       | yes (after image-build) |
| `dev`         | auto¹                                                        | auto¹   | manual → `numa-deploy-dev` | manual                  |
| `dev-image/*` | auto                                                         | auto    | manual → `numa-deploy-dev` | n/a                     |
| anything else | auto (lint+test only)                                        | skip    | skip                       | n/a                     |
| MR pipeline   | auto (lint+test only, plus `mr-sanity` to keep GitLab happy) | skip    | skip                       | n/a                     |

¹ The `dev` branch pipeline is gated by the `deploy-dev-gate` manual button at `.pre` stage. Until clicked, nothing else runs. This is to prevent every dev push from burning a full pipeline.

### The image-build job, in detail

There's one shared anchor `.build-deployment-container-base` and two thin jobs that override `ECR_REPO` and the firing rule:

```yaml
.build-deployment-container-base:        # shared logic
  stage: image-build
  # docker build → tag :${SHA} → assume AWS_CLIENT_ROLE_ARN → docker push

build-deployment-container:               # prod
  extends: .build-deployment-container-base
  variables: { ECR_REPO: ${ECR_BASE}/numa-deploy }
  rules: [!reference [.rules, if-main]]

build-deployment-container-dev:           # dev
  extends: .build-deployment-container-base
  variables: { ECR_REPO: ${ECR_BASE}/numa-deploy-dev }
  rules: [!reference [.rules, if-dev-image-buildable]]   # when: manual
```

`AWS_CLIENT_ROLE_ARN` is a CI/CD variable that points at `arn:aws:iam::826326270637:role/arcanum-ci`. That role has wildcard `ecr:*` push permissions on `Resource: "*"`, so pushing to `numa-deploy-dev` doesn't need any IAM change — it just works as long as the destination ECR repo exists.

### Pipeline-level CI/CD variables you need to know about

| Variable               | Source                                       | Used for                                                                                 |
| ---------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `AWS_CLIENT_ROLE_ARN`  | GitLab project settings                      | Role assumed by image-build to push ECR                                                  |
| `ECR_BASE`             | GitLab project settings                      | `826326270637.dkr.ecr.ap-southeast-2.amazonaws.com`                                      |
| `ECR_REGION`           | optional override, defaults `ap-southeast-2` | Region for `aws ecr get-login-password`                                                  |
| `DEPLOY_ALL_CUSTOMERS` | set per-pipeline via Run Pipeline UI         | If `=1` on main, all customer deploy jobs run automatically instead of as manual buttons |

These live in the GitLab project's CI/CD settings, not in the repo. Don't expose `AWS_CLIENT_ROLE_ARN` outside trusted contexts — it's the door to the images account.

---

## ECR repos and IAM

Three AWS accounts are involved.

| Account                   | ID             | Purpose                                                                                  |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `arcanum-prod-images`     | `826326270637` | Holds `numa-deploy` and `numa-deploy-dev` ECR repos                                      |
| `arcanum-q-deployer-prod` | `207567759910` | Holds the Customer Success Portal, the deploy state machine, ECS, DynamoDB               |
| Backend / Terraform state | `442483608950` | Holds the GitLab CI IAM user (`gitlab-ci`), the Terraform state S3 bucket and lock table |

### The CI push role: `arcanum-ci` (in images account)

- Trusted by IAM user `arn:aws:iam::442483608950:user/gitlab-ci`.
- Created by CDKTF in a separate repo `arcanumai/arcanum-infra`, stack `image-distribution`. **Not in this repo.**
- Inline policies:
  - `ci-push-permissions` — `ecr:{GetAuthorizationToken,CompleteLayerUpload,UploadLayerPart,InitiateLayerUpload,BatchCheckLayerAvailability,PutImage}` on `Resource: "*"`
  - `ci-create-repository-permissions` — `ecr:CreateRepository` on `Resource: "*"` (so CI can self-bootstrap a new repo if one is referenced but missing)

If you need to add a new ECR repo, the role already permits push — you only need to create the repo and set its resource policy.

### The portal authenticated role: `customer-success-portal-authenticated-role` (in deployer account)

- Trusted by Cognito Identity Pool `customer_portal_identity_pool` (federated authentication).
- Defined in CDKTF: [infra/constructs/customer-success-portal-construct.ts](../../infra/constructs/customer-success-portal-construct.ts).
- Has `ecr:DescribeImages, ecr:ListImages, ecr:DescribeRepositories` on **both** repo ARNs (the dev repo was added when the dev channel shipped).
- Has `sts:AssumeRole` on `arn:aws:iam::*:role/ArcanumAIAccess` for cross-account tools (Usage/Quota reports).

### The portal deploy task-exec role: `numa-portal-deploy-task-exec` (in deployer account)

- Trusted by `ecs-tasks.amazonaws.com`.
- Used by the ECS Fargate task to **pull** the deployment image from the images account.
- Has `ecr:{GetAuthorizationToken,BatchCheckLayerAvailability,BatchGetImage,GetDownloadUrlForLayer}` on `Resource: "*"` (cross-account ECR pull is gated by the _repo policy_ on the ECR side, not by the task role).

### The repo policies

Each ECR repo in the images account has a policy that explicitly allows the portal authenticated role to list/describe and the task-exec role to pull. The dev repo's policy is committed at [tools/aws/numa-deploy-dev-repo-policy.json](../../tools/aws/numa-deploy-dev-repo-policy.json) for traceability. The prod repo's policy is identical in structure (just a different `Sid`) and was set manually when the repo was first bootstrapped.

If you want to apply the dev policy by hand:

```bash
AWS_PROFILE=arcanum-prod-images aws ecr set-repository-policy \
  --region ap-southeast-2 \
  --repository-name numa-deploy-dev \
  --policy-text file://tools/aws/numa-deploy-dev-repo-policy.json
```

### Mutability

| Repo              | Mutability                         | Why                                                                                                                   |
| ----------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `numa-deploy`     | `IMMUTABLE_WITH_EXCLUSION{latest}` | SHA tags are content-addressed, so they must be immutable; `:latest` is the floating tag pointing at most-recent main |
| `numa-deploy-dev` | `IMMUTABLE` (no exclusions)        | We're not pushing `:latest` to dev, so there's nothing that needs to move                                             |

Re-running a failed CI pipeline on the same SHA will fail to push (immutable). That's a feature: if the image already exists, there's nothing to rebuild.

---

## The deployment container

The image pushed to ECR is a single container that bundles everything CDKTF needs to deploy a Numa client stack:

- All Python lambda zips, copied to `lambdas/python/<name>/lambda_function.zip`
- All Node lambda bundles
- Optional service container TARs (workspace-agent, browser-lambda) at `infra/assets/artifacts/<name>/image.tar`
- The full `infra/` directory plus a baked-in `node_modules`
- Yarn, Node, Terraform, AWS CLI, skopeo

Build context: [infra/container/Dockerfile](../../infra/container/Dockerfile). Each Lambda's deploy time-provisioner uses the in-container zip rather than re-bundling.

When the portal's ECS task starts, the entrypoint is `yarn`, with command `workspace @arcanumai/q-apps-deployer-infra exec cdktf deploy --auto-approve numa-<clientName>`. The task runs as a long-lived Fargate task (up to 2h timeout enforced by the state machine).

---

## Customer Success Portal

Source: [numa-customer-success-portal/](../../numa-customer-success-portal/). React 19 SPA, deployed by CDKTF in [infra/constructs/customer-success-portal-construct.ts](../../infra/constructs/customer-success-portal-construct.ts) and used as the only mechanism for triggering customer deployments.

See also the portal's own [README.md](../../numa-customer-success-portal/README.md) and [CLAUDE.md](../../numa-customer-success-portal/CLAUDE.md).

### How it lists images

[ecrService.ts](../../numa-customer-success-portal/src/services/ecrService.ts) holds two singletons (`prodEcrService`, `devEcrService`) — one per channel. Each calls `ECRClient.DescribeImagesCommand` against its repo, paginating through up to 100 results per page. Browser AWS credentials come from the Cognito Identity Pool, which assumes the portal authenticated role.

Both channels' image lists are loaded eagerly on Containers/Deployments page load so tab switches feel instant.

### Custom image names (the metadata table)

Users can attach custom names + descriptions to specific image digests. Storage:

- DynamoDB table `numa-portal-image-metadata` in `arcanum-q-deployer-prod`, region `us-east-1`
- Hash key: `imageTag` (string), range key: `digest` (string)
- The `imageTag` field is **encoded** as `${repository}#${realTag}` so prod and dev images keep separate name spaces. Pre-migration rows have just the bare tag and are treated as `numa-deploy`.

The encoding is done in [imageTagService.ts](../../numa-customer-success-portal/src/services/imageTagService.ts). All callers pass the repository explicitly; the service handles encoding/decoding.

### How it triggers a deploy

Single-client deploy:

1. User picks: channel (Production/Dev), client, image, deployment label, mode (deploy/plan).
2. [Deployments.tsx](../../numa-customer-success-portal/src/pages/Deployments.tsx) calls `startDeployment` in [deploymentService.ts](../../numa-customer-success-portal/src/services/deploymentService.ts).
3. `startDeployment` calls `StartExecution` on Step Functions state machine `NumaPortalDeployment`, passing `{ clientName, imageTag, repository, initiatedBy, deploymentId, ... }`.
4. The state machine ([infra/constructs/portal-deployments-construct.ts](../../infra/constructs/portal-deployments-construct.ts)):
   - Acquires a per-client lock in `numa-portal-deployments` (DynamoDB conditional put). If another deploy is in flight for this client, this fails fast.
   - Calls Lambda `portal-deploy-assume-backend` to get temporary STS credentials for the Terraform state account (account `442483608950`).
   - Registers a new ECS task definition with image = `States.Format('${registryUri}/{}:{}', $.repository, $.imageTag)`. This is where the channel matters: the URI is built dynamically.
   - `RunTask` on Fargate. The task pulls the image cross-account (from images account 826326270637), gets the backend creds, and runs `yarn cdktf deploy --auto-approve numa-<client>` inside the container.
   - Polls `DescribeTasks` for completion, with a 2h overall timeout.
   - Records status to `numa-portal-deployments` and releases the lock.

Group deploy is the same but wrapped in a parent state machine that fans out into the single-client SM with bounded concurrency.

### Foot-gun guard

Deploying a Dev image to a non-`devInstance` client requires typing the client name to confirm. For groups, deploying a Dev image to a group containing any production client requires typing the group name. Logic in [Deployments.tsx](../../numa-customer-success-portal/src/pages/Deployments.tsx).

The `devInstance` flag lives on each client's config in `numa-client-config` — clients like `arcanum-demo`, `nd-labs`, `arcanum-demo-greg` are flagged as dev/demo; production customer stacks are not. The auto-managed "All Production Clients" group filters out `devInstance: true` clients automatically.

---

## Recipes

### Recipe: Deploy main → a customer

1. Merge MR to `main`.
2. Wait ~12 min for the main pipeline to finish (`build-deployment-container` produces the image).
3. Open Customer Success Portal → Deployments page.
4. Channel = Production (default).
5. Pick the client, the image (most recent should be at the top, often with a custom name), enter a deployment label.
6. Click Start Deployment, confirm the modal.
7. Watch the History tab — the deployment runs ~20–25 min for a typical client.

### Recipe: Build and deploy a dev image from `dev`

1. Merge MR to `dev`.
2. Open the dev pipeline. Click `deploy-dev-gate` to release it.
3. After packaging finishes, click `build-deployment-container-dev`. Image lands at `numa-deploy-dev:${SHA}`.
4. Optionally click `deploy-to-arcanum-demo` for a free quick-deploy to the demo client.
5. To deploy to a different client: portal → Deployments → channel = Dev → pick image → pick client.

### Recipe: Build a dev image from a feature branch

1. Branch your feature work as `dev-image/<name>` (the prefix is what the CI rule matches).
2. Push.
3. Pipeline runs through packaging automatically.
4. Click `build-deployment-container-dev`.
5. Image lands at `numa-deploy-dev:${SHA}` and is selectable in the portal's Dev tab.

This is the lowest-overhead way to test something complete (all lambdas + frontend) before merging to dev. Cost: full packaging stage runs on every push to that branch.

### Recipe: Rename or describe an image

1. Portal → Containers page → pick channel tab.
2. Click "Add Name" / "Edit" on the image row.
3. Enter custom name + optional description, save.
4. The metadata is keyed on `${repository}#${imageTag} + digest`, so a rename only ever affects that exact digest in that exact channel.

### Recipe: Add a third image channel (hypothetically)

If we ever wanted a `numa-deploy-staging` channel:

1. Create the ECR repo in images account, set its policy to mirror `numa-deploy-dev`.
2. Add a new `build-deployment-container-staging` job to `.gitlab-ci.yml` extending `.build-deployment-container-base`, with appropriate rules (e.g. on a `release/*` branch).
3. Add the new repo ARN to the portal authenticated role's ECR resource list in [customer-success-portal-construct.ts](../../infra/constructs/customer-success-portal-construct.ts).
4. Add the new repo name to the `RepositoryName` type in [imageTagService.ts](../../numa-customer-success-portal/src/services/imageTagService.ts) and the `CHANNELS` arrays in [Containers.tsx](../../numa-customer-success-portal/src/pages/Containers.tsx) and [Deployments.tsx](../../numa-customer-success-portal/src/pages/Deployments.tsx).
5. Deploy the portal infra to update the IAM, then redeploy the SPA.

The hot path (the SFN state machine) needs no change: it already takes `repository` from input.

---

## Troubleshooting

### "I clicked the dev image build button and it failed at AWS auth"

The error usually says something about STS or `AccessDenied`. Likely causes:

- `AWS_CLIENT_ROLE_ARN` in GitLab CI variables is unset or wrong. Check GitLab project settings → CI/CD → Variables.
- The IAM user `gitlab-ci` in account `442483608950` has lost permission to assume `arcanum-ci`. Check the trust policy on `arcanum-ci` in the images account.
- The push role's policy was rotated and lost `ecr:PutImage` etc. Run `AWS_PROFILE=arcanum-prod-images aws iam get-role-policy --role-name arcanum-ci --policy-name ci-push-permissions` and verify.

### "Deploy task fails with `image not found` or `unauthorized`"

The ECS task can't pull the image. Check:

- The image actually exists at the URI: `aws ecr describe-images --repository-name <repo> --image-ids imageTag=<tag>`.
- The repo policy in the images account allows the task-exec role. Run `aws ecr get-repository-policy --repository-name <repo>` against the images account and verify the policy's `Principal.AWS` includes `arn:aws:iam::207567759910:role/numa-portal-deploy-task-exec`.
- The task-exec role has `ecr:BatchGetImage` etc. on `Resource: "*"`. See [portal-deployments-construct.ts](../../infra/constructs/portal-deployments-construct.ts).

### "Custom image name disappeared from one channel"

Likely the metadata row is keyed under the wrong repository prefix. Inspect:

```bash
AWS_PROFILE=arcanum-q-deployer-prod aws dynamodb scan \
  --region us-east-1 \
  --table-name numa-portal-image-metadata \
  --filter-expression "begins_with(imageTag, :p)" \
  --expression-attribute-values '{":p": {"S": "numa-deploy"}}'
```

For pre-migration rows (un-prefixed `imageTag`), the portal still serves them as Production via the backwards-compat read in [imageTagService.ts](../../numa-customer-success-portal/src/services/imageTagService.ts). If you've already run the cleanup script and an old row is missing, the migration script can be re-run from a backup.

### "MR pipeline shows zero jobs and fails to create"

This is what `mr-sanity` exists to prevent. If you're seeing it again, it means an MR's pipeline rules all evaluate to `when: never`. Add the changed paths to the relevant `changes:` filters, or rely on `mr-sanity` (which fires on any MR pipeline) to keep things alive.

### "I want to delete a bad image"

```bash
AWS_PROFILE=arcanum-prod-images aws ecr batch-delete-image \
  --region ap-southeast-2 \
  --repository-name <repo> \
  --image-ids imageTag=<tag>
```

This is the only way to "fix" a bad image because both repos are immutable for SHA tags. After deletion, you can re-run the CI job to re-push the same SHA.

### "Pipeline scaling is broken / runners are slow"

Not a deployment-pipeline issue per se — see [documentation/gitlab-runners/](../gitlab-runners/) for the runner ASG, hotfix log, and queue-monitor Lambda.

---

## Related documents

- [numa-customer-success-portal/README.md](../../numa-customer-success-portal/README.md) — full portal architecture
- [numa-customer-success-portal/CLAUDE.md](../../numa-customer-success-portal/CLAUDE.md) — portal dev guide
- [documentation/gitlab-runners/](../gitlab-runners/) — runner fleet, scaling, hotfix log
- [tools/aws/numa-deploy-dev-repo-policy.json](../../tools/aws/numa-deploy-dev-repo-policy.json) — committed source of truth for the dev ECR repo policy
- [tools/backup-portal-image-metadata.ts](../../tools/backup-portal-image-metadata.ts), [tools/migrate-portal-image-metadata.ts](../../tools/migrate-portal-image-metadata.ts), [tools/cleanup-portal-image-metadata-old-rows.ts](../../tools/cleanup-portal-image-metadata-old-rows.ts) — metadata table tooling
