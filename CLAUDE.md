# Who We Are

We are experienced developers using AI tools to move faster and build better software. You are an expert-level AI — act like it. Don't underestimate your own capabilities, don't dumb things down, and don't hedge when you have a clear recommendation. Challenge our ideas and point out flaws — we want your honest technical opinion, not agreement for the sake of it. But the final call is always ours. Match quality to context: production changes should be production-ready, experimental work can be scrappy.

**Quality bar:** Always reason thoroughly and deeply. Treat every request as complex unless explicitly told otherwise. Never optimize for brevity at the expense of quality. Think step-by-step, consider tradeoffs, and provide comprehensive analysis. Do not take shortcuts, skip steps, or produce shallow work to save tokens.

**Architectural decisions require human input.** Do not make significant architectural choices (new patterns, major refactors, technology selections, data model changes, infrastructure decisions) without discussing them with the user first. Present options, explain tradeoffs, and let the user decide. The code is easy to write — picking the right direction is the hard part.

---

## CLAUDE.md Structure

This is the top-level project CLAUDE.md — it serves as a high-level map and orientation guide. Sub-directories contain their own CLAUDE.md files with detailed, domain-specific guidance that auto-loads when working in those directories.

**Existing sub-files:**

- `numa-frontend/CLAUDE.md` — Frontend architecture, auth patterns, i18n, config, state management, testing
- `numa-customer-success-portal/CLAUDE.md` — Customer Success Portal architecture, deployment, AWS setup

When adding new guidance, put it in the most specific CLAUDE.md that applies. Only add to this top-level file if it's cross-cutting or needed for general orientation. If a sub-file doesn't exist yet for an area (e.g., `services/numa-workspace-agent/`, `infra/`), consider creating one rather than bloating this file.

---

## Arcanum AI Team

Numa is built by Arcanum AI, a New Zealand-based company founded in 2016. Here's the team:

| Name                  | Role                                 | Email                    |
| --------------------- | ------------------------------------ | ------------------------ |
| Asa Cox               | CEO                                  | asa@arcanum.ai           |
| Scott Houston         | Chairman                             | scott@arcanum.ai         |
| Ian Dougherty         | COO                                  | ian@arcanum.ai           |
| Jayson Satya          | CRO                                  | jayson@arcanum.ai        |
| Connor Nickel         | Business Development & Sales Officer | connor@arcanum.ai        |
| Tony Gurnick          | Engineering Lead                     | tony.gurnick@arcanum.ai  |
| Nathan Douglas        | Senior AI Engineer                   | nathan@arcanum.ai        |
| Greg Frantzen         | Software Engineer                    | greg.frantzen@arcanum.ai |
| Tom Wiltshire         | Junior AI Engineer                   | tom.wiltshire@arcanum.ai |
| Prasanna Ramachandran | Customer Success                     | pras@arcanum.ai          |
| Lily Coats            | Business Development                 | lily.coats@arcanum.ai    |

---

# Code Conventions

- **Python:** Pure functions for business logic, classes only for infrastructure. Use Poetry for deps. Async I/O for all Lambda handlers.
- **Node Lambdas:** TypeScript, functional style. Bundle with `yarn bundle`.
- **Frontend:** React functional components, Bootstrap 5 styling, i18n for all UI text (see `numa-frontend/CLAUDE.md`).
- **Infra:** CDKTF (TypeScript). Constructs compose into stacks.
- **Idempotency:** Side effects must be safe to retry. Design all endpoints and state mutations to be idempotent.
- **Observability:** Log at boundaries (Lambda entry/exit, API calls, state transitions). Use structured logs with a `_name` field for filtering.

# Skills

Skills are stored in `.claude/skills/` and contain detailed context for specific areas of the codebase. **You MUST load the relevant skill before writing any code in that area. No exceptions.** Skills contain checklist requirements, framework rules, and architectural decisions that are not repeated in this file.

- **Claude Code / Anthropic models:** Activate the skill by name (e.g., `/numa-connectors`).
- **Other AI tools:** Read the skill's `SKILL.md` file directly from `.claude/skills/<skill-name>/SKILL.md` (and any supporting `.md` files in the same folder). The content is the same — just markdown on disk.

| Skill                        | When to activate                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `numa-workspace-agent-skill` | Working on the workspace agent service — code, debugging, features, streaming, tools, agent type configuration                                             |
| `workspace-agent-local-test` | Testing workspace agent Docker container locally, SDK integration testing                                                                                  |
| `numa-agents`                | Agent builder, agent APIs, agent database schema, agent tools config, visibility settings                                                                  |
| `numa-apps`                  | Creating/modifying apps, app constructs, Step Functions, state machines, jobs, manifests                                                                   |
| `numa-ops`                   | Numa Ops work — tickets, kanban boards, teams, projects, customers, suppliers, CRM, backlog                                                                |
| `numa-connectors`            | Creating or modifying data connectors (OAuth, token, API-key), connectorRegistry, Files Remote, connector wizards, backend providers                       |
| `numa-integrations`          | Pipedream integrations — proxy model, adding integrations, admin policies, workspace agent integration prompts                                             |
| `numa-triggers`              | Numa Automations event triggers (native + Pipedream-backed) — adding sources, debugging webhooks, trigger lifecycle, source/trigger picker UX              |
| `nolia-developer-guide`      | Any Nolia work — agent types, prompts, orchestrator, workspace setup, KB integration, rules generation                                                     |
| `numa-scheduled-agents`      | Agent scheduling, schedule runner, EventBridge, cron expressions, scheduled run config                                                                     |
| `numa-gitlab`                | Checking CI/CD pipeline status, viewing failed jobs, retrying, MR details                                                                                  |
| `numa-unlock-customer`       | Unblocking stuck customer deployments — Terraform locks, resource conflicts, CNAME issues                                                                  |
| `debug-customer-issue`       | Investigating customer-reported bugs — log gathering, user lookup, timeline reconstruction, root cause analysis                                            |
| `lint-and-tests`             | Running linting, type checking, or tests after code changes                                                                                                |
| `playwright-cli`             | Browser automation — web testing, form filling, screenshots, data extraction, great for doing automated tests of features in development                   |
| `extending-numa-chat`        | Adding new tools/capabilities to Numa chat -- numa CLI commands, skills/prompts, Lambda delegation, HITL approvals, frontend rendering, agent type configs |
| `skill-creator`              | Creating new skills                                                                                                                                        |

# Documentation

The `documentation/` folder contains detailed reference docs for specific domains. These are committed to the repo and complement the skills above. Read the relevant docs when working in these areas.

| Folder                                | Contents                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documentation/connectors/`           | Data connector architecture, two-secret model, complete checklist, framework rules, workspace agent integration                                                                                                                                                                                     |
| `documentation/credits/`              | Numa Credit System (SPK-015): full developer/agent reference — value+floor pricing model, ledger schema, drawdown/settlement, shared lib, live metering, portal authoring, in-client view, defaults & flags, operations, open questions                                                             |
| `documentation/deployment-pipelines/` | End-to-end pipeline: GitLab CI → ECR (prod/dev channels) → Customer Success Portal → Step Functions/ECS → CDKTF                                                                                                                                                                                     |
| `documentation/email-sending/`        | Centralized email sender: architecture, security model, templates, code examples, infra wiring, deployment                                                                                                                                                                                          |
| `documentation/extending-numa-chat/`  | How to extend Numa chat with new tools: numa CLI commands, skills, Lambda delegation, HITL, frontend rendering, agent types                                                                                                                                                                         |
| `documentation/gitlab-runners/`       | Shared CI runners: AWS resources, autoscaler architecture, tokens, common ops, hotfix log                                                                                                                                                                                                           |
| `documentation/nolia/`                | Nolia architecture, pipeline details, rules generation, project notes                                                                                                                                                                                                                               |
| `documentation/numa-standard-model/`  | Numa Standard Model (DeepSeek V4 Flash via Novita): opaque-id proxy → relay → OpenRouter architecture, three-tier model selection + feature flag, per-agent model, credits (¼ multiplier) + cost observability (total_cost_usd source of truth), local-dev harness, the 200K context-window finding |
| `documentation/numa-voice/`           | Numa Voice (Amazon Connect SDR dialer): FEAT-158 Phase-1 Connect setup runbook (manual instance, recording storage, DIDs, approved origins, deploy guard)                                                                                                                                           |
| `documentation/pipedream/`            | Pipedream integration into Numa: proxy/relay architecture, account model, security boundaries, triggers deep-dive + add-a-trigger guide, API reference cheat sheet                                                                                                                                  |

---

# Context7

If the Context7 MCP server is enabled, always use it automatically when doing code generation, setup/configuration steps, or looking up library/API documentation. Resolve library IDs and fetch docs without being asked.

# AWS Profiles & Accounts

| Profile                   | Account    | ID           | Purpose                                                                         |
| ------------------------- | ---------- | ------------ | ------------------------------------------------------------------------------- |
| `q-demo`                  | Q Demo     | 905418183804 | Dev/demo stacks — all dev client accounts live here                             |
| `arcanum-q-deployer-prod` | Q Deployer | 207567759910 | Deployer account — holds `numa-client-config` table, deploys to client accounts |
| `arcanum-prod-numa-demo`  | HQ/Demo    | —            | HQ stack — Arcanum's own Numa instance (dogfooding). Client name: `hq`          |

Use `AWS_PROFILE=q-demo` for most local dev and client account access. Use `AWS_PROFILE=arcanum-prod-numa-demo` for the HQ stack. Use `AWS_PROFILE=arcanum-q-deployer-prod` for deployer-level operations (e.g., `cd tools/ && AWS_PROFILE=arcanum-q-deployer-prod yarn retrieve-config nolia`).

**Regions:** Most stacks are `us-east-1`. Some clients use `ap-southeast-2` (Sydney). Nolia uses `ap-southeast-3` (Jakarta) with cross-region AgentCore in Sydney.

# Numa — High-Level Overview

Numa is a multi-tenant, serverless enterprise AI platform on AWS. Each client has an isolated AWS account with a dedicated frontend, AI services, knowledge bases, and orchestration.

## Key Pillars

- **Chat:** AI chat powered by the Claude Agent SDK, running on AWS Bedrock AgentCore MicroVMs (`numa-workspace-agent`). Persistent workspaces with sandboxed Python/Bash code execution, file management, skills/plugins system, and extended thinking.
- **Apps:** Repeatable “input -> process -> output” flows using Step Functions + specialized Lambdas (document analysis, policy generation, candidate screening, financial analysis, etc.). V2 Apps run on AgentCore instead of Step Functions (experimental).
- **Integrations:** Pipedream Connect integrations via a secure, Arcanum-owned proxy account. Exposes SaaS tools (Gmail, Slack, Jira, etc.) to chat.
- **Numa Ops:** Built-in work management module — tickets, kanban boards, projects, customers, suppliers.
- **Data Connectors:** OAuth/token-based connectors for external data sources (SharePoint, Google Drive, Box, etc.) surfaced through Files Remote and workspace chat.

## Architecture at a Glance

- **Frontend:** React 19 + Vite + Bootstrap 5 (`/numa-frontend`). Chat at `/chat`, apps at `/dash`, ops at `/ops`.
- **Lambdas:** 55+ Python and 29 Node functions under `/lambdas` — app steps, API handlers, proxies, schedulers.
- **Services:** Containerized agents under `/services/` on Bedrock AgentCore MicroVMs (e.g., `numa-workspace-agent`).
- **Infrastructure:** CDKTF (TypeScript) in `/infra` — stacks and constructs for per-client environments.
- **State & Data:**
  - DynamoDB: client config, chat history, job status, agents, ops tickets, integration policies.
  - S3: per-client “outputs” bucket (chat uploads, app artifacts) and “data” bucket (knowledge base files).
  - Step Functions: orchestrate multi-step app workflows.

---

## Frontend (numa-frontend)

React 19 + Vite + Bootstrap 5. Dev commands: `yarn install`, `yarn run dev`, `yarn build`, `yarn test`, `yarn lint`.

**IMPORTANT:** `numa-frontend/CLAUDE.md` contains critical frontend development patterns and architecture details. It is automatically loaded when working in the frontend directory. It covers:

- Token access patterns (AuthProvider) — how to avoid stale credentials
- API request patterns (RequestProvider) — authenticated requests via `useNumaRequest()`
- AWS SDK client patterns — centralized client creation, never create locally
- i18n rules — all UI text must use translations, ESLint enforced
- Language picker + LLM language integration
- Config loading, feature flags, and `config.json` (auto-generated, never edit directly)
- Component and routing architecture
- Provider hierarchy and state management
- Chat transport and streaming
- Testing setup (Vitest + Playwright)

---

## Legacy Chat Agent — V1 (DEPRECATED)

Chat V1 (`lambdas/python/numa-chat-agent`) is deprecated — replaced by the workspace agent. Still in the codebase but no longer the active chat backend.

---

## Chat Agent (services/numa-workspace-agent)

The `numa-workspace-agent` is the **default and primary chat backend** — a containerized Python service on AWS Bedrock AgentCore MicroVMs, accessed at `/chat`. Core concepts:

- **Per-conversation MicroVM:** Each conversation gets its own isolated MicroVM (`conv-{conversationId}`). 1hr idle timeout, 8hr max. No cross-conversation contamination.
- **Persistent workspace (`/workdir`):** Uploads and outputs synced to S3 after each request. Up to 200MB file uploads via direct S3.
- **Claude Agent SDK:** Agentic loop with up to 50 tool-use turns, extended thinking (up to 10k tokens).
- **numa CLI + skills/plugins:** Tools are invoked via the `numa` CLI through Bash (`numa <category> <command> ...` — categories: files, web, docs, agents, memory, integrations, ops, render). Covers KB queries, web search, document handling, integrations. Sandboxed code execution runs via Bash (write a script to `/workdir/tmp/` and run it). Skills are read-only in `/app/plugins/numa/skills/`.
- **Security:** PreToolUse/PostToolUse hooks block dangerous imports, directory traversal, and system path access. Container runs as non-root (UID 1000).
- **Model selection (`WORKSPACE_CHAT_MODEL_SELECTION` flag):** three tiers, selectable in the chat input and **per-agent** — **Standard** = the **Numa Standard Model** (DeepSeek V4 Flash via Novita, cheap everyday tier, bills ¼ credits), **Premium** = Sonnet 4.6 (the default), **Expert** = Opus 4.6 (3× credits). The Standard model is **non-Anthropic and opaque**: the container only ever sees the id `numa-standard-model` and reaches the real model through an in-container proxy → deployer-account relay → OpenRouter/Novita (the real model name + API key live only in the relay). Currently **feature-flag tested on HQ**. Full architecture, credits, cost observability, and local-dev harness in `documentation/numa-standard-model/`.

### CloudWatch Log Groups

Per-client patterns (e.g., for client `nd-labs`):

- **Container (richest data):** `/numa/{clientName}/workspace-chat-agent`
- **Proxy:** `/aws/lambda/{clientName}-workspace-chat-agent-proxy`
- **Vendedlogs:** `/aws/vendedlogs/bedrock-agentcore/numa-{clientName}-workspace-chat` — not useful, ignore

Filter by `_name` field (e.g., `COST`, `STREAM_COMPLETE`, `CHAT_REQUEST`).

For full details (module structure, API contract, tools, debugging, CloudWatch queries), see `services/numa-workspace-agent/README.md`. Activate the `numa-workspace-agent-skill` before doing any work here.

---

## Numa CLI (the chat agent's tool layer)

The workspace agent invokes all platform capabilities through a unified **`numa` CLI** over Bash (it replaced the old MCP tool layer — the agent runs with **zero MCP servers**):

```
numa <category> <command> ... -m "user-visible caption"
```

Categories: `files`, `web`, `docs`, `agents`, `memory`, `integrations`, `ops`, `render`. Each `numa <cat> <cmd> --help` self-documents. The CLI POSTs to the `numa-cli-api` Lambda, which gates (Ops entitlement → per-agent-type allow-list → HITL approval) and routes to the Python handlers in `lambdas/python/workspace-chat-tools/`.

**Two binaries:** `numa` (prod, bundled in the workspace image — production-safe commands only) and `numa-dev` (laptop only — adds bypass flags, self-tests, `whoami`).

**Drive it from a laptop** (debugging / scripting):

```bash
cd numa-cli && yarn install && yarn build
node packages/cli/dist/cli/numa.js login <client>      # Cognito SRP; caches ~/.config/numa/tokens-<client>.json
node packages/cli/dist/cli/numa.js agents list --json -m "check"
# dev binary (extra commands): node packages/cli-dev/dist/cli/numa-dev.js whoami
```

**Docs:**

- `documentation/numa-cli/README.md` — **canonical architecture & design reference** (transports, identity model, the gates, permission model, hooks, rate limit, saved workflows).
- `numa-cli/CLAUDE.md` — package dev guide (auto-loads when working in `numa-cli/`).
- `documentation/extending-numa-chat/` + the `extending-numa-chat` skill — how to add a new CLI command/tool.

> **Maintenance:** when a CLI architecture/security/design decision changes, update `documentation/numa-cli/README.md` — it's the single source of truth. The CLAUDE.md/skill touchpoints just point to it. Also regenerate the human reference `numa-cli/docs/numa-cli-reference-internal.html` when commands/flags change.

---

## Services (Containerized Agents)

`/services/` contains containerized agents deployed on Bedrock AgentCore (ARM64 Docker images on Graviton). Currently: `numa-workspace-agent/`.

**Packaging:** Requires Docker Desktop. Run `cd services && ./package-service.sh numa-workspace-agent`. Output: `infra/assets/artifacts/numa-workspace-agent/image.tar` (pushed to ECR via `skopeo` during deploy).

---

## Numa Apps

**V1 Apps:** Step Functions + Lambdas. Each app extends a base construct (`/infra/constructs/apps`) that wires API routes, S3 prefixes, and logging. `step-function-start` kicks off the state machine, `step-function-status` provides run status. Results land in S3 outputs and/or DynamoDB jobs table.

**V2 Apps (experimental):** Run on AgentCore MicroVMs instead of Step Functions. Fire-and-forget pattern — API triggers the agent, results written to S3 at `v2-apps/{appId}/{user_sub}/{runId}/_result.json`.

Activate the `numa-apps` skill before doing any apps work.

---

## Integrations (Pipedream Connect)

SaaS integrations use a cross-account proxy model. A dedicated Arcanum-owned account hosts the Pipedream proxy — OAuth credentials are centralized, never in client accounts. Client accounts call a relay Lambda that forwards to the proxy (validated against an allowlist). Enabled via `PIPEDREAM_INTEGRATIONS` feature flag. Admins can set allow/deny tool policies per integration.

---

## Infrastructure Stacks (CDKTF /infra)

| Stack                      | Purpose                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `numa-client-stack.ts`     | Core per-client stack — Cognito, API Gateway, CloudFront, S3, DynamoDB, Step Functions, Lambdas, workspace agent constructs, knowledge bases |
| `nextgen-root-stack.ts`    | AWS account bootstrap — creates/organizes client accounts, roles, SSO access                                                                 |
| `pipedream-proxy-stack.ts` | Integrations proxy account — cross-account Lambda, OAuth secrets, user mapping                                                               |
| `q-apps-deployer-stack.ts` | Deployer account — `numa-client-config` table, Route53, Customer Success Portal                                                              |

CloudFront routes `/api/*` to API Gateway and `/api/numa-chat-agent/*` directly to the chat agent Function URL with the shared secret header.

---

## Data, Storage, and Knowledge Bases

- **S3 buckets per client:** `outputs` (app artifacts, chat uploads, run status) and `data` (knowledge base documents).
- **Knowledge bases:** Amazon Q Business (enterprise search) or Bedrock KB (S3-backed vector store, ~30min indexing cadence). Configurable per client.
- **Chat history:** DynamoDB `numa-<client>-chat-history` — conversation turns, tool use, results frames.
- **Workspace chat traces:** S3 at `s3://numa-<client>-outputs/numa-chat/workspace/<user_sub>/conversations/<conversation_id>/_system/trace.jsonl` — NDJSON event log of the full conversation (user messages, assistant messages, StreamEvents, tool use, completions). Loaded on page refresh to reconstruct chat state.

### ⚠️ outputsBucket lifecycle ownership

The per-client `outputs` bucket is shared across **multiple consumers**: chat uploads, app artifacts, V2 app outputs, scheduled-run logs, etc. Terraform's `aws_s3_bucket_lifecycle_configuration` resource **fully replaces** the bucket's lifecycle config — it is NOT additive. Today only one rule exists (`expire-scheduled-runs-90d` in `app-agnostic-api-gateway-lambda-collection.ts`, prefixed to `numa-chat/scheduled-runs/`).

**If you need to add a lifecycle rule to `outputsBucket` (e.g. expiring old chat artifacts, KB temp files):**

- ❌ Do **not** create a second `S3BucketLifecycleConfiguration` resource targeting the same bucket — Terraform will silently last-applied-wins, and one of the rules disappears with no error.
- ✅ Add your rule to the existing `S3BucketLifecycleConfiguration` block in `app-agnostic-api-gateway-lambda-collection.ts:scheduled-runs-lifecycle`, alongside the FEAT-105 rule. Use a distinct `id`, `filter.prefix`, and `expiration` per rule.
- ✅ Or refactor the existing block into a centralised `OutputsBucketLifecycle` construct that takes an array of rules — worth doing once we have ≥ 2 consumers.

**Other buckets (`data`, `binary-cache`, `racetech-*`, `recovery-*`)** each have their own lifecycle blocks and don't currently conflict — but the same rule applies if you ever add a second one to the same bucket.

---

## Configuration and Multi-Tenant Model

Each client deploys into its own isolated AWS account. The deployer account (Q Deployer, `arcanum-q-deployer-prod`) assumes an `ArcanumAIAccess` role into client accounts to provision infrastructure. Integrations use a separate proxy account.

**Instance URLs:** All Numa instances follow the pattern `https://<client-name>.numa.arcanum.ai/`. The custom domain field in client config exists but is unreliable without manual fiddling -- don't use it. Assume the standard subdomain pattern.

**Single source of truth:** The `numa-client-config` DynamoDB table in the deployer account holds all client configuration — region, feature flags, preferred knowledge base, budget, etc. The frontend `public/config.json` is gitignored and local-only — developers edit it for localhost. In deployed environments, it’s auto-generated from the DynamoDB table.

**Reading client config:** Always use the `retrieve-config` tool rather than raw DynamoDB queries: `cd tools/ && AWS_PROFILE=arcanum-q-deployer-prod yarn retrieve-config <client-name>`. It resolves defaults and merges correctly — raw DynamoDB items may omit flags that default to `false`, giving an incomplete picture.

### clientConfigProd.json — Local Dev Override

`clientConfigProd.json` is a local-only convenience file for quick testing. It is **not persistent** — it’s gitignored and only affects local deploys. During `make deploy`, the config loader (`lib/client-config-node/index.ts`) checks this file first. If a client exists in it, that config is used **entirely** and DynamoDB is skipped — meaning any flags missing from the file will default to `false`. Keep entries minimal or remove clients you’re not actively overriding.

---

## Security Model

- **Auth:** Cognito User Pool + JWTs. API Gateway custom authorizer verifies tokens + CloudFront secret.
- **Cross-account:** Deployer assumes roles into client accounts. Integrations validate caller account identity.
- **Secrets:** Integration OAuth credentials in Secrets Manager (proxy account).
- **Workspace isolation:** Each conversation in its own AgentCore MicroVM. Security hooks block dangerous imports, directory traversal, system path access. Non-root container (UID 1000). Plugins outside workspace (read-only).
- **PRM:** All AWS SDK calls must carry Marketplace product code `cl23v3vsno0k35czlg7e3ld9p`. Use: Python `from prm import client, resource`, Node `withPRM` from `lib/prm-node/prm`, frontend `withPRM` from `src/utils/prmUtils`.

---

## Email Sending

Numa uses a centralized `numa-email-sender` Lambda in the deployer account for all transactional email. Emails are sent from `no-reply@notifications.numa.arcanum.ai` via SES with full DKIM/SPF/DMARC. Cross-account callers authenticate via STS presigned URL proof (same pattern as Pipedream).

**Do not** create per-Lambda SES setups or send email directly from client accounts. All email goes through the centralized sender for consistent branding, deliverability, and security.

See `documentation/email-sending/` for the full guide: architecture, security model, invocation payload, template reference, code examples (Python + Node), infra wiring instructions, and deployment steps.

---

## Development & Deployment

**Frontend:** `yarn install`, `yarn dev`, `yarn build`, `yarn test`, `yarn lint --fix`

**Lambdas (Python):** Poetry for deps. Package one: `cd lambdas && bash package-python-lambda.sh python/<name>`. Package all: `bash package-all.sh`.

**Lambdas (Node):** Package one: `cd lambdas && bash package-node-lambda.sh node/<name>`. Or `yarn bundle` in the lambda directory.

**Lambdas (Container):** For Lambdas that need system-level deps (e.g. Playwright/Chromium). Each has its own `Dockerfile` in the lambda directory. Build context is the repo root so shared libs (`lib/prm`) are accessible. Package: `cd lambdas && bash package-container-lambda.sh python/<name>`. Output: `infra/assets/artifacts/<name>/image.tar`. Deployed as ARM64 container images via ECR (skopeo push). Uses `NumaLambda` with `packageType: 'Image'` and `imageUri`. First example: `browser-lambda` (Playwright + Chromium for JS-rendered page fetching).

### Deployed Lambda Naming (gotcha — burns us repeatedly)

Lambda names on AWS use **two different separators** between `clientName` and the logical Lambda name, depending on which construct created them:

- **`{clientName}_{lambda-name}`** (underscore) — every Lambda registered via `addLambdaFunction()` on `ApiGatewayLambdaCollection` / `AppAgnosticApiGatewayLambdaCollection`. That's ~110 API-Gateway-fronted Lambdas (most of the `/api/*` surface). Examples: `nd-labs_srp-hasher`, `nd-labs_admin-integration-settings-get`, `nd-labs_numa-cli-api`. Comes from `resourceNameSuffix: '_' + name` in [api-gateway-lambda-collection.ts:58](infra/constructs/api-gateway-lambda-collection.ts#L58) — the underscore is hard-coded into the suffix before `awsNameWithHashedPrefix` concatenates it to the client name with no separator.
- **`{clientName}-{lambda-name}`** (hyphen) — Lambdas instantiated directly via `NumaLambda` or via other collection constructs (apps, custom resources, schedulers). Examples: `nd-labs-cloudfront-invalidator`, `nd-labs-s3vectors-manager`, `nd-labs-workspace-chat-agent-proxy`. Apps further mix the two: `nd-labs-e2e-test_main-start` (hyphen client→app, underscore inside the step).

When searching for a Lambda by name (`aws lambda get-function`, CloudWatch log filtering, IAM policy targets), try **both** separators. If the Lambda is registered behind `/api/*`, it's almost certainly underscore-separated. To search blind:

```bash
aws lambda list-functions --profile q-demo --region us-east-1 \
  --query "Functions[?contains(FunctionName,'<client>') && contains(FunctionName,'<fragment>')].FunctionName" \
  --output json
```

> ⚠️ **Adding a new lambda? Update the CI matrix.** If the lambda is part of the per-client **Numa deploy**, you MUST add it to the matching matrix in `.gitlab-ci.yml` — `.python-lambdas-matrix` (Python) or `.node-matrix` (Node). That matrix drives **both** CI packaging (the `lambda_function.zip` the deploy reads) **and** the lint/type/test check. Forget it and `cdktf deploy` dies at synth with `filebase64sha256(".../lambda_function.zip"): no such file or directory`. **Exception — do NOT add** lambdas that aren't in the per-client Numa stack: deployer/portal lambdas (`q-apps-deployer-stack`, e.g. `numa-email-sender`, `numa-voice-config-writer`, `numa-fleet-analytics-rollup`), Pipedream proxy-account lambdas (`pipedream-proxy-stack`, e.g. `pipedream-schema-refresh`), and container lambdas (their own `package-container-lambda.sh` build, e.g. `browser-lambda`).

**Services:** See Services section above for Docker packaging.

**Infra (CDKTF):** Build frontend + package lambdas first, then `yarn cdktf deploy --auto-approve <stack>`.

### Deploying to Dev Stacks (Local)

To deploy a dev stack locally, run from within `infra/`:

```bash
yarn && yarn get
export TF_ENVIRONMENT=prod
export AWS_REGION=us-east-1
export CLIENT_OVERRIDE=<client-name>
yarn cdktf deploy --auto-approve numa-<client-name>
```

**Important rules:**

- **Always confirm with the user before deploying.** Never trigger a deploy autonomously.
- **Run deploys as background tasks.** They can take up to 30 minutes.
- **NEVER deploy to customer stacks locally.** Customer deployments must go through the Customer Success Portal UI, triggered by the user. Local deploys are only for dev stacks (e.g., `nd-labs`, `arcanum-demo-greg`).

**Terraform lock issues:** If a deploy fails with a state lock error, resolve it from the Terraform output directory:

```bash
cd infra/cdktf.out/prod/stacks/numa-<client-name>
AWS_PROFILE=arcanum-dev terraform force-unlock --force <lock-id>
```

Gotchas:

- The lock table is `arcanum-terraform-lock` in account `458119850496`, region `ap-southeast-2` — accessible via the `arcanum-dev` profile. **Not** `q-demo` or `arcanum-q-deployer-prod`. Using the wrong profile/region gives `ResourceNotFoundException` and makes it look like the unlock is broken when it isn't.
- `cd` into the stack folder first — `terraform` reads the backend config (bucket, region, dynamodb_table) from `cdk.tf.json` in that directory.
- If `terraform force-unlock` returns **`Failed to unlock state: LocalState not locked`**, that's **success**, not failure. It means terraform reached the right table and confirmed no lock with that ID exists — you're clear to retry the deploy.
- Sanity-check the table directly: `AWS_PROFILE=arcanum-dev aws dynamodb scan --table-name arcanum-terraform-lock --region ap-southeast-2 --projection-expression LockID`.

## Branching Strategy

Feature branches -> `dev` (default MR target) -> `main` (release). No pipeline on `dev` push. Full pipeline on `main` push. Hotfixes can target `main` directly — merge back into `dev` afterwards.

---

## Folder Guide

- `/numa-frontend/` — React app (see `numa-frontend/CLAUDE.md` for details)
- `/services/` — Containerized agents for Bedrock AgentCore (e.g., `numa-workspace-agent`)
- `/lambdas/python/` — 55+ Python Lambdas (workspace agent proxy/tools, app steps, content extraction, Pipedream proxy/relay, etc.)
- `/lambdas/node/` — 29 Node Lambdas (authorizers, agents API, scheduling, notifications, numa-ops, branding, etc.)
- `/infra/` — CDKTF stacks and constructs (client, deployer, NextGen, Pipedream proxy, workspace agent, KBs)
- `/lib/` — Shared libraries (Bedrock, S3, PRM, OAuth providers, utilities)
- `/tools/` — Operational tools and dev scripts (create users, retrieve config, check index progress, reports). **All custom scripts and tools for dev usage belong here — not in the repo root.** If you're writing a helper script, put it in `tools/`.
- `/documentation/` — Domain-specific docs (connectors, nolia)
- `/deployer/` — Streamlit-based Q Apps deployer tool
- `/numa-customer-success-portal/` — Customer Success Portal frontend (see its own `CLAUDE.md`)
- `/initial-account-setup/` — CloudFormation templates for AWS account bootstrapping
- `/docs/` — Architecture documentation and task specs
- `/style/` — Shared ESLint configuration base

---

## Numa Ops

Lightweight work management module (tickets, kanban boards, projects, customers, suppliers) built into Numa. Designed by Ian (COO/PM) — his POC at `documentation/numa-ops/ian-design/The actual Work Ops App/` is the gold standard for feature parity. Backend: Node Lambdas prefixed `numa-ops-*`. Frontend: `OpsPage` at `/ops`, components in `Components/Ops/`.

Activate the `numa-ops` skill before doing any Ops work.

---

## Nolia

AI-powered document compliance and assessment platform, delivered as two products from separate frontend repos in `arcanum/nolia/`:

- **`nolia-app/`** — Bank / MDB procurement compliance (World Bank, ADB, IsDB). Validates TER/CER/ToR/RFP against MDB policy via a multi-phase AI pipeline on AgentCore. Production: `nolia-id-gov-moh` in `ap-southeast-3` (Jakarta).
- **`nolia-funding-app/`** — Funding application assessment (Funds / Grants / Scholarships). Anchor client: Te Rūnanga o Ngāi Tahu (NZ). Variant-aware codebase (`NEXT_PUBLIC_NOLIA_VARIANT = funding | procurement`). Production: `ngaitahu` in `ap-southeast-2` (Sydney).

Both frontends are thin Express proxies; all AI lives in this repo under `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/`.

Activate the `nolia-developer-guide` skill before doing any Nolia work. See also `documentation/nolia/`.
