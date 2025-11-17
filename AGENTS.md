# Numa — High‑Level Overview

This document orients AI agents and contributors to the Numa platform at a glance. It focuses on the frontend, Lambda backends, and infrastructure stacks that deploy per‑client environments.

## What Numa Is

Numa is a multi‑tenant, serverless enterprise AI platform on AWS. Each client has an isolated AWS account, with a dedicated frontend, AI Lambdas, knowledge bases, and orchestration. Key pillars:

- Chat: Real‑time AI chat via the core `numa-chat-agent` Lambda, integrated with Bedrock models and optional knowledge bases (Amazon Q Business or Bedrock KB). Supports web search and external integrations.
- Apps: Repeatable “input → process → output” flows implemented with Step Functions and specialized Lambdas (document analysis, policy generation, candidate screening, financial analysis, and more).
- Integrations: Optional Pipedream Connect integrations (via a secure, Arcanum‑owned proxy account) to safely expose SaaS tools to chat.

## Architecture at a Glance

- Frontend: React 19 + Vite + Bootstrap 5 (`/numa-frontend`)
    - Primary chat UI is `NumaChatAgents` (legacy `NumaChat` remains for backup).
    - Calls the chat agent over HTTP streaming (NDJSON) via CloudFront.
- Lambdas: 30+ specialized functions (Python primary; some Node for system tasks) under `/lambdas`.
- Infrastructure: CDK for Terraform (CDKTF, TypeScript) in `/infra`, with stacks that create per‑client environments.
- State & Data:
    - DynamoDB: configuration, chat history, job status (by app), admin integration policies.
    - S3: per‑client “outputs” bucket (chat uploads, app run artifacts) and “data” bucket (knowledge base files).
    - Step Functions: orchestrate multi‑step application workflows.

---

## Frontend (numa-frontend)

- Tech stack: React 19 + Vite; Bootstrap 5 styling.
- Entry points:
    - Main chat: `src/Pages/NumaChatAgents.tsx` (canonical chat page going forward).
    - Knowledge base management, app launchers, settings, user management, etc. are organized under `src/Pages` and `src/Components`.
- Configuration: `public/config.json` injected at runtime (Cognito IDs, region, buckets, API base, feature flags like `PIPEDREAM_INTEGRATIONS`, relay Lambda ARN, preferred knowledge base, etc.).
- Chat transport: Uses HTTP streaming to `/api/numa-chat-agent/stream` with NDJSON frames. CloudFront injects an `x-arcanum-cloudfront-secret` header; the frontend attaches a Cognito bearer token.
- Integrations UX: When enabled and configured, the chat UI can query connected integrations (via a cross‑account proxy relay). Admins can also set default allow/deny policies for tool usage.

Dev commands:
- `yarn install`, `yarn run dev`, `yarn build`, `yarn test`
- Lint all workspaces (excluding infra): `yarn workspaces foreach --parallel --all --exclude infra run lint --fix`

---

## Core Chat Agent (lambdas/python/numa-chat-agent)

The `numa-chat-agent` Python Lambda powers Numa Chat:

- Runtime & transport:
    - FastAPI app served via AWS Lambda Web Adapter (LWA) in ZIP mode.
    - Exposed through a Lambda Function URL placed behind CloudFront.
    - Streams NDJSON events (start, event, ping, completion) to the frontend.
- Models & agents:
    - Uses AWS Bedrock models and “Strands Agents” style event shapes for tool use.
    - Tools include `query_knowledge_base` (Amazon Q Business or Bedrock KB) and `web_search`.
    - Optional MCP/MCP‑style tools via the Pipedream proxy (see Integrations below).
- Auth & safety:
    - Validates Cognito tokens; CloudFront shared secret required on all requests.
    - Reads conversation history from DynamoDB to maintain continuity.
- Configuration (via environment): preferred knowledge base, Bedrock KB ID or Q app/retriever IDs, outputs/data bucket ARNs, supported integrations, optional global integration settings table, and CloudFront secret.

Frontend integration: The chat page `NumaChatAgents` calls `Services/chatAgentService.ts` for request/stream handling, including tool event frames and chunk assembly.

---

## Numa Apps (Step Functions + Lambdas)

Numa’s “Apps” are standard input/output flows defined in infra constructs and implemented by Lambdas. Patterns:

- App construct: Each app extends a base construct that wires API routes, S3 prefixes, and logging.
- Start/status endpoints:
    - `step-function-start` Lambda starts the app’s state machine.
    - `step-function-status` Lambda provides run status and artifacts.
- Typical steps include:
    - File ingest to S3 outputs bucket under an app‑specific prefix.
    - Content extraction (`extract-content-from-file`), LLM prompts, domain logic.
    - Results written to S3 outputs and/or a DynamoDB jobs table (when enabled).
- Step Functions have retry/catch policies and write intermediate/final statuses (S3 or DynamoDB) consumed by the frontend.

This pattern powers apps like Document Summariser, Policy Builder, Candidate Screening, Financial Analysis, and others under `/infra/constructs/apps` and `/lambdas/python/*`.

---

## Integrations (Pipedream Connect)

Numa integrates with external SaaS tools through a secure proxy model:

- Dedicated proxy account: A separate Arcanum‑owned AWS account hosts the Pipedream proxy so OAuth credentials are centralized and never deployed into client accounts.
- Cross‑account access: Client accounts call a relay Lambda that forwards to the proxy Lambda (which validates caller account against an allowlist). User‑to‑integration mapping is maintained in DynamoDB.
- Frontend flow:
    - If `PIPEDREAM_INTEGRATIONS` is enabled in `config.json`, the chat page initializes a cross‑account `LambdaClient` (via Web Identity) and uses `PipedreamProxyService` to list connected apps, generate connect tokens, and call MCP‑style tools.
    - Admins can set global allow/deny tool policies per integration; chat enforces these.
- Infra stacks involved: see “Infrastructure Stacks” below (`pipedream-proxy-stack`, relay packaging, account sync of allowed accounts).

---

## Infrastructure Stacks (CDKTF /infra)

Numa uses multiple stacks to support multi‑tenant deployment and secure integrations:

- numa-client-stack.ts — core per‑client stack
    - Provisions the client’s Cognito, API Gateway + authorizer, CloudFront, S3 buckets (outputs, data, frontend), chat DynamoDB tables, Step Functions, Lambdas for apps, the `numa-chat-agent` function URL, and knowledge base(s).
    - Configurable preferred knowledge base: Amazon Q Business or Bedrock KB.
    - Can enable Pipedream integrations by wiring the cross‑account relay Lambda ARN.

- nextgen-root-stack.ts — NextGen org/account bootstrap
    - Used to create and organize AWS accounts (Nextgen) that will host client deployments.
    - Creates roles and Step Functions to automate account creation, SSO access, and initial config.

- pipedream-proxy-stack.ts — integrations in a dedicated Arcanum account
    - Hosts the cross‑account proxy Lambda, user‑mapping and allowed‑accounts tables, secrets for OAuth, and an hourly account‑sync Lambda that reads the deployer’s client config table.

- q-apps-deployer-stack.ts — deployer account resources
    - Deploys shared resources to the deployer account, including the `numa-client-config` DynamoDB table and Honeycomb keys in SSM, domain/Route53 scaffolding, and optional Customer Success Portal infra.

CloudFront routing: The frontend distribution forwards `/api/*` to API Gateway and `/api/numa-chat-agent/*` directly to the chat agent Function URL, adding the CloudFront shared secret header.

---

## Data, Storage, and Knowledge Bases

- Buckets per client:
    - `outputs` bucket: app artifacts, chat uploads, and run status files.
    - `data` bucket: knowledge base documents (also a separate `company` bucket for company data where relevant).
- Knowledge bases:
    - Amazon Q Business: enterprise search with web experience integration and optional index units; WebExperience callback is wired to Cognito.
    - Bedrock Knowledge Base: S3‑backed vector store with periodic indexing (typically ~30‑minute cadence) and retrieval via `bedrock:Retrieve` during chat.
- Chat history: DynamoDB `numa-<client>-chat-history` tracks conversation turns, tool use, and results frames for accurate message reconstruction.

---

## Configuration and Multi‑Tenant Model

- Client config: A per‑client JSON record (in DynamoDB for prod; dev examples in `clientConfigProd.json`) determines region, preferred knowledge base, Q vs Bedrock enablement, whether to deploy all apps, Pipedream integration flag, budgets, etc.
- Per‑client isolation: Each client deploys into its own AWS account. The deployer account assumes into the client account to deploy infra. Integrations use a separate proxy account.
- Feature flags & FE config: `public/config.json` and session storage carry resolved values (client name, region, bucket names, Pipedream relay ARN, `PIPEDREAM_INTEGRATIONS`, preferred KB, etc.).

---

## Security Model

- Authentication: Amazon Cognito User Pool + User Pool Client; frontend obtains JWTs for API calls.
- API protection: API Gateway custom authorizer verifies Cognito tokens and CloudFront secret. Chat Function URL sits behind CloudFront; all requests must include the shared secret header.
- Cross‑account access: Deployer assumes roles into client accounts; client chat agent can assume web identity roles as needed; integrations validate caller account identity.
- Secrets: OAuth credentials for integrations are stored in Secrets Manager in the dedicated proxy account.

---

## Development & Deployment

- Frontend
    - Dev: `yarn install`, `yarn run dev`
    - Build before infra deploy: `yarn build`
    - Tests: `yarn test`

- Lambdas (Python)
    - Use Poetry for deps, lint, and tests.
    - Package a single Lambda (preferred): `bash package-python-lambda.sh lambdas/python/<lambda_name>`
    - Package all (slow): `bash package-all.sh`

- Infrastructure (CDKTF)
    - Ensure frontend is built and Lambdas are packaged before `cdktf deploy`.
    - Deploy to a target client (example env vars + stack name) using `yarn cdktf deploy --auto-approve <stack>`.

---

## Folder Guide

- `/numa-frontend/` – React app (Pages, Components, Services), including `NumaChatAgents` and integrations UI.
- `/lambdas/python/` – Python Lambdas (e.g., `numa-chat-agent`, `extract-content-from-file`, app‑specific steps, Pipedream proxy/relay, web search proxy, etc.).
- `/lambdas/node/` – Node Lambdas for infrastructure/system tasks (authorizers, cleanup, shims, vector init, etc.).
- `/infra/` – CDKTF stacks and constructs for client, deployer, NextGen (account creation), Pipedream proxy, knowledge bases, and frontend infra.
- `/lib/` – Shared libraries and helpers (Bedrock, S3, utilities).
- `/tools/` – Operational tools (create users, write/retrieve config, check index progress, reports, etc.).

---

## Mental Model for Agents

1) If deploying to clients, it runs out of the numa-client-stack where we assume an ArcanumAIAccess role from the deployer accounts creds to be able to create all the resources in the client account. This is also useful for local dev to access/see resources in the client account.
2) For chat tasks, the `numa-chat-agent` Lambda is the hub: it streams tokens, invokes Bedrock, queries the selected knowledge base, and optionally calls MCP tools through the Pipedream proxy.
3) For app tasks, follow the app construct → Step Function → Lambda chain, with S3 prefixes in the outputs bucket and optional job status in DynamoDB.
4) For integrations, treat Pipedream access as cross‑account and centrally secured; rely on the relay/proxy pattern.

This overview is intended as a consistent “starting map” before diving into implementation details or specific tasks.
