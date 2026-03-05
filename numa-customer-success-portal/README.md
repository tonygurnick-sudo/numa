# Numa Customer Success Portal

Internal portal for the Customer Success team to view client configurations, browse deployment container images, run deployments, generate operational reports, and manage users — all without touching CI/CD.

Built as a static React 19 + TypeScript app (Vite, Bootstrap 5) that authenticates with Cognito and uses an Identity Pool to obtain AWS credentials directly in the browser.

Live deployment is provisioned by the CDKTF construct at `infra/constructs/customer-success-portal-construct.ts` and integrated via `infra/stacks/q-apps-deployer-stack.ts`.

Contents below are what an AI agent or engineer needs to work productively with this portal.

## What’s Implemented Today

- Authentication via Cognito (User Pool + Identity Pool)
- Config loader from `public/config.json` (in prod, generated to S3 by infra)
- Dashboard with quick stats and tool launcher
- Client Configs viewer (read-only) powered by `@arcanumai/client-config`
- Container Images (ECR) browser for `numa-deploy`
- Deployments: trigger infra deploys per client via Step Functions + ECS
- Tools:
  - Usage Report: pulls app runs and chat messages from client DynamoDB tables, exports CSV/JSON
  - Quota Report: discovers Bedrock quota codes and fetches RPM quotas across client accounts/regions
- User Management: create/delete users in the portal’s own User Pool, plus a self‑service Create/Reset Password flow

Not included yet: a config editor (was part of the original plan but not in this POC).

## Architecture Overview

- React SPA hosted on S3 + CloudFront
- Cognito User Pool (auth) + Cognito Identity Pool (browser AWS credentials)
- IAM role `customer-success-portal-authenticated-role` attached to the Identity Pool for authenticated users
- Reads client config from DynamoDB table `numa-client-config` using the shared library `@arcanumai/client-config`
- Reads ECR image metadata from the images account/region (see Config)
- For Tools (Usage/Quota), assumes `arn:aws:iam::<client-account-id>:role/ArcanumAIAccess` in client accounts using STS

Deployments architecture additions:

- Step Functions state machine `NumaPortalDeployment` orchestrates each deploy
- DynamoDB table `numa-portal-deployments` stores history and status (GSI `clientName-index`)
- ECS Fargate task runs the `numa-deploy` container and executes `cdktf deploy numa-<client>`
- Node Lambda `portal-deploy-assume-backend` returns temporary credentials for the Terraform backend (S3 state + DynamoDB lock) in the root account
- One-time auto-retry: if the first run fails in a 25–35 minute window (token expiry heuristic), the state machine retries once; attempts are recorded and shown in the portal (1/2 → 2/2)

Infra creates and wires all of the above. Static files are uploaded from `dist/` during `cdktf deploy` and `config.json` is created server-side in S3.

## Configuration (public/config.json)

The SPA loads required configuration at runtime from `/config.json`. For local dev, copy and edit `public/config.json`. In production, infra writes this object to the S3 bucket so you don’t need to commit secrets.

Required keys and meaning:

```json
{
  "AWS_REGION": "us-east-1", // Region of the portal stack and Cognito
  "USER_POOL_ID": "us-east-1_XXXX", // Cognito User Pool ID for login
  "USER_POOL_CLIENT_ID": "xxxxxxxx", // Cognito User Pool client (no secret)
  "IDENTITY_POOL_ID": "us-east-1:uuid...", // Cognito Identity Pool for AWS creds
  "CLIENT_CONFIG_TABLE": "numa-client-config", // DynamoDB table for client configs

  "ECR_REGION": "ap-southeast-2", // Where the images repo lives (optional)
  "ECR_REGISTRY_ID": "826326270637", // Images account (optional)
  "ECR_REPOSITORY_URI": "https://.../numa-deploy", // Display only (optional)

  // Deployments (populated by infra when enabled)
  "DEPLOYMENTS_TABLE": "numa-portal-deployments",
  "DEPLOYMENT_SFN_ARN": "arn:aws:states:us-east-1:207567759910:stateMachine:NumaPortalDeployment"
}
```

How it’s used:

- `src/services/configService.ts` fetches `/config.json` and caches values in `sessionStorage` (7‑minute TTL)
- Cognito clients derive AWS credentials via `fromCognitoIdentityPool`
- ECR/ServiceQuotas/DynamoDB clients are constructed on demand with the credential provider
- Tools assume `ArcanumAIAccess` in client accounts from the browser using STS

## Permissions and IAM

Portal authenticated users receive the IAM role and policy created by the construct:

- Read client configs: `dynamodb:{GetItem,Query,Scan}` on `numa-client-config`
- Read images: `ecr:{DescribeImages,ListImages}` on `arn:aws:ecr:ap-southeast-2:826326270637:repository/numa-deploy`
- User management: `cognito-idp:{AdminCreateUser,ListUsers,AdminDeleteUser,AdminGetUser,AdminSetUserPassword,DescribeUserPool}` on the portal User Pool
- STS assume role: `sts:AssumeRole` on `arn:aws:iam::*:role/ArcanumAIAccess` (restricted by region)

Cross‑account ECR access requires a repository resource policy in the images account. Example (update Principal to your deployer account):

```json
{
  "Version": "2008-10-17",
  "Statement": [
    {
      "Sid": "AllowPortalRead",
      "Effect": "Allow",
      "Principal": {
        "AWS": ["arn:aws:iam::207567759910:role/customer-success-portal-authenticated-role"]
      },
      "Action": ["ecr:DescribeImages", "ecr:ListImages"]
    }
  ]
}
```

Client accounts must have an `ArcanumAIAccess` role that the portal can assume. Tools will fail for a client if that role is absent or trust/permissions are missing.

## Running Tools

Credentials flow used by both tools:

- Sign in with Cognito → Identity Pool issues browser credentials in the deployer account
- The tool assumes `arn:aws:iam::<client-account-id>:role/ArcanumAIAccess` via STS for each target client/region
- AWS SDK calls then run in the client account using that temporary role

Usage Report (per‑client):

- Navigate: Tools → Usage Report
- Select client, time period, and output format (CSV or JSON)
- Data sources in client account: `${clientName}-<app>-recent-jobs` (jobs), `numa-${clientName}-chat-history` (chat)
- Enrichment: looks up User Pool `numa-${clientName}` to attach user emails (best‑effort)
- Output: CSVs (app runs, chat messages, summary) or a single JSON; progress updates shown during scans

Quota Report (multi‑client):

- Navigate: Tools → Quota Report
- Choose scope (all/selected clients), regions, model families (Claude/Nova), optional filter text, and quota types (On‑demand/Cross‑region)
- The tool discovers quota codes from the first selected client/region, then fetches values across all selected client accounts/regions
- Output: CSV (and table in UI); missing/denied quotas appear as blank values

Required setup for tools:

- Client accounts must define `ArcanumAIAccess` with trust to the portal’s authenticated role principal (`arn:aws:iam::<deployer-account-id>:role/customer-success-portal-authenticated-role`)
- Regions must be allowed by IAM condition (infra defaults to `us-east-1` and `ap-southeast-2`)

Tool troubleshooting:

- Access denied: verify client role trust and permissions, and that your user is authenticated (token still valid)
- No data: tables may not exist yet for that client/time period; JSON export can help verify
- Quota discovery empty: adjust families/types/filter or ensure Bedrock quotas exist in the discovery region

## App Structure

```
src/
├── components/               # Navigation, auth guards, tools UI widgets
├── contexts/                 # AuthContext (Cognito session + refresh loop)
├── hooks/                    # useAssumeRole, useToolExecution
├── pages/                    # Dashboard, Configs, Containers, Users, Tools
├── services/                 # auth, client config, ECR, DynamoDB/Quotas
├── styles/                   # Bootstrap theming (Arcanum purple/black)
├── types/                    # Client config schema + tool types
└── utils/                    # CSV/JSON exports, date helpers
```

Key files:

- `src/components/ConfigLoader.tsx` — fetches config.json at startup, caches to sessionStorage
- `src/contexts/AuthContext.tsx` — Cognito auth, token refresh, role checks
- `src/services/clientService.ts` — lists/gets client configs via `@arcanumai/client-config`
- `src/services/ecrService.ts` — reads `numa-deploy` images from ECR
- `src/services/deploymentService.ts` — starts executions, queries history, builds logs/ECS links
- `src/services/usageReportService.ts` — scans client DynamoDB job/chat tables
- `src/services/quotaReportService.ts` — discovers and fetches Bedrock RPM quotas
- `src/pages/UserManagement.tsx` + `src/services/userManagementService.ts` — portal user CRUD and self‑service password flows

Data assumptions for tools:

- Jobs tables: `${clientName}-<app>-recent-jobs`
- Chat table: `numa-${clientName}-chat-history`

## Local Development

- Install: `yarn install`
- Run dev server: `yarn dev` (http://localhost:5173)
- Build: `yarn build` (outputs to `dist/`)
- Test: `yarn test`
- Lint: `yarn lint`

Local dev uses `public/config.json`. Ensure it references a live portal Cognito User Pool/Identity Pool so you can sign in. No backend runs locally — all AWS calls are from the browser using Cognito credentials.

Node 18+ is recommended. This workspace is part of the monorepo and uses Yarn 4.

## Deployment

The portal deploys as part of the deployer stack when `enableCustomerSuccessPortal` is true. Typical flow:

1. Build the portal locally

```bash
cd numa-customer-success-portal
yarn build
```

2. Deploy infra (uploads `dist/` to S3 and writes `config.json`)

```bash
cd ../infra
yarn
yarn get
export TF_ENVIRONMENT=prod
export AWS_REGION=us-east-1
export CLIENT_OVERRIDE=none
yarn cdktf deploy --auto-approve q-apps-deployer
```

3. If the site still shows cached assets, create a CloudFront invalidation using the output distribution ID:

```bash
aws cloudfront create-invalidation --distribution-id <ID> --paths '/*'
```

Outputs include the portal URL, S3 bucket name, CloudFront distribution ID, and Cognito identifiers.

### Deployments (Infra + IAM summary)

- State machine `NumaPortalDeployment` flow (high level): record start → assume backend role via Lambda → register+run ECS task → poll DescribeTasks → record success/failure and logs → one auto-retry on ~30‑minute failures.
- Backend (Terraform state) account resources:
  - S3 bucket: `arcanum-terraform-state` (ap-southeast-2)
  - DynamoDB table: `arcanum-terraform-lock` (ap-southeast-2)
  - Backend IAM role (example): `arn:aws:iam::442483608950:role/terraform-backend-access`
    - Trust principal: `arn:aws:iam::207567759910:role/portal-deploy-assume-backend-role`
    - Identity policy: S3 List/Get/Put/Delete on the tfstate key prefix; DynamoDB Describe/Get/Put/Delete/Update on the lock table; add KMS actions if required.
- Deployer account:
  - Lambda `portal-deploy-assume-backend` with role `portal-deploy-assume-backend-role` (allowed to `sts:AssumeRole` into the backend role)
  - ECS task passes temporary backend creds to Terraform and sets `TF_CLI_ARGS_apply=-parallelism=20`

## Troubleshooting

- Login loop or auth errors: confirm `/config.json` values match the deployed Cognito pool and app client
- “Not authenticated” when listing ECR/images: verify the ECR repository policy includes the portal role principal and the portal IAM policy allows ECR reads
- Quota/Usage tools fail for a client: ensure the client account has `ArcanumAIAccess` with trust to the portal’s role and the required DynamoDB tables exist
- “Configuration not loaded” message: `src/services/configService.ts` requires all required keys; check the S3 `config.json`
- Deploy failures around ~30 minutes: the state machine retries once automatically. If repeated, consider extending STS session durations and/or lowering parallelism.

## Extending the Portal

- Add a new tool: create a page in `src/pages/`, wire UI via `ToolCard`, use `useToolExecution` for progress/status, and add AWS calls in a `src/services/*Service.ts`
- Add a new AWS integration: prefer using Identity Pool creds (browser) and scoped IAM permissions; avoid embedding secrets
- Add new client‑config fields: update the Zod schema in `src/types/index.ts` and reflect in viewers/editors

## Related Docs

- Infra construct: `infra/constructs/customer-success-portal-construct.ts:1`
- Stack integration: `infra/stacks/q-apps-deployer-stack.ts:1`
- Planning docs (pre‑build; may be partially outdated): `.docs/tasks/customer-success-portal/README.md:1`, `.docs/tasks/customer-success-portal/technical-summary.md:1`
