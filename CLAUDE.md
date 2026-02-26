# Who i am

I am a new developer. I am intrested in what you do so please explaing what you are doing and why

---

## Arcanum AI Team

Numa is built by Arcanum AI, a New Zealand-based company founded in 2016. Here's the team:

| Name | Role | Email |
|------|------|-------|
| Asa Cox | CEO | asa@arcanum.ai |
| Scott Houston | Chairman | scott@arcanum.ai |
| Ian Dougherty | COO | ian@arcanum.ai |
| Jayson Satya | CRO | jayson@arcanum.ai |
| Connor Nickel | Business Development & Sales Officer | connor@arcanum.ai |
| Tony Gurnick | Engineering Lead | tony.gurnick@arcanum.ai |
| Nathan Douglas | Senior AI Engineer | nathan@arcanum.ai |
| Greg Frantzen | Software Engineer | greg.frantzen@arcanum.ai |
| Tom Wiltshire | Junior AI Engineer | tom.wiltshire@arcanum.ai |
| Prasanna Ramachandran | Customer Success | pras@arcanum.ai |
| Lily Coats | Business Development | lily.coats@arcanum.ai |

---

# Guiding Primciples

These 9 principles guide the high-performance, functional architecture:

1. Pure Functional Programming - No Classes: Business logic as pure functions, classes only
   for infrastructure
2. Pipeline Architecture - Linear Data Flow: Data flows through sequence of transformations
3. Explicit Contracts - Type-Safe Schemas: Full type hints, dataclasses for schemas
4. Async-First - Non-Blocking I/O: All I/O operations async to prevent event loop blocking
5. Encapsulation - One Module = One Responsibility: Clear separation of concerns
6. Testability - Pure Functions = Easy Tests: No mocking required for business logic
7. No Magic - Explicit > Implicit: Clear, documented behavior, no hidden transformations
8. Performance-Aware - Optimize for Throughput: Target 1,000+ requests/second
9. Debuggability - Logs + Metrics at Boundaries: Observability at key decision points
10. Idempotent systems - Safe, repeatable, well thought out, Idempotent and logical side effects.

# context 7

Always use context7 when I need code generation, setup or configuration steps, or
library/API documentation. This means you should automatically use the Context7 MCP
tools to resolve library id and get library docs without me having to explicitly ask.

# AWS Profile

When running AWS CLI commands for this project, use `AWS_PROFILE=q-demo`. For example:
```bash
AWS_PROFILE=q-demo aws iot list-targets-for-policy --policy-name "some-policy"
```

# Numa — High‑Level Overview

This document orients AI agents and contributors to the Numa platform at a glance. It covers the frontend, Lambda backends, containerized services (AgentCore), and infrastructure stacks that deploy per‑client environments.

## What Numa Is

Numa is a multi‑tenant, serverless enterprise AI platform on AWS. Each client has an isolated AWS account, with a dedicated frontend, AI Lambdas, knowledge bases, and orchestration. Key pillars:

- Chat: AI chat powered by the Claude Agent SDK, running on AWS Bedrock AgentCore MicroVMs. Provides persistent workspaces with full Python/Bash code execution in a sandboxed environment, file management, a skills/plugins system, and extended thinking. This is the `numa-workspace-agent` service (formerly "Chat V2" / "Workspace Chat").
- Chat V1 (DEPRECATED): The legacy `numa-chat-agent` Lambda. No longer the default — replaced by the workspace agent above. Still exists in the codebase but is not the active chat experience.
- Apps: Repeatable "input → process → output" flows implemented with Step Functions and specialized Lambdas (document analysis, policy generation, candidate screening, financial analysis, and more).
- Integrations: Optional Pipedream Connect integrations (via a secure, Arcanum‑owned proxy account) to safely expose SaaS tools to chat.

## Architecture at a Glance

- Frontend: React 19 + Vite + Bootstrap 5 (`/numa-frontend`)
  - Chat: `NumaWorkspaceChatAgents` at `/chat` — workspace agent with Claude SDK streaming. This is the default and primary chat experience.
  - Chat V1 (DEPRECATED): `NumaChatAgents` — legacy Bedrock/Strands streaming. No longer the default route.
- Lambdas: 55+ Python and 29 Node specialized functions under `/lambdas`.
- Services: Containerized agents under `/services/` deployed as Docker images on AWS Bedrock AgentCore MicroVMs (e.g., `numa-workspace-agent`).
- Infrastructure: CDK for Terraform (CDKTF, TypeScript) in `/infra`, with stacks that create per‑client environments.
- State & Data:
  - DynamoDB: configuration, chat history, job status (by app), admin integration policies.
  - S3: per‑client “outputs” bucket (chat uploads, app run artifacts) and “data” bucket (knowledge base files).
  - Step Functions: orchestrate multi‑step application workflows.

---

## Frontend (numa-frontend)

- Tech stack: React 19 + Vite; Bootstrap 5 styling.
- Entry points:
  - Chat: `src/Pages/NumaWorkspaceChatAgents.tsx` at `/chat`. Uses `Services/workspaceChatAgentService.ts`. Supports model selection (Sonnet 4.5, Opus 4.5, Haiku 4.5), direct S3 uploads up to 200MB, extended thinking, and workspace file management. Components in `src/Components/WorkspaceChat/`.
  - Chat V1 (DEPRECATED): `src/Pages/NumaChatAgents.tsx` — legacy chat page, no longer the default route.
  - Agents: `src/Pages/AgentsManagement.tsx` at `/agents` — agent builder, listing, scheduling.
  - Scheduling: `src/Pages/SchedulingPage.tsx` at `/scheduling` (behind `SCHEDULING` flag).
  - Data Connectors: `src/Pages/DataConnectorsPage.tsx` at `/data-connectors` (behind `DATA_CONNECTORS_ENABLED` flag).
  - Notifications: `src/Pages/NotificationsPage.tsx` at `/notifications` (behind `SCHEDULING` flag).
  - Job History: `src/Pages/JobHistoryManager.tsx` at `/job-history`.
  - Knowledge base management, app launchers, settings, user management, etc. are organized under `src/Pages` and `src/Components`.
- Configuration: `public/config.json` injected at runtime (Cognito IDs, region, buckets, API base, feature flags, relay Lambda ARN, preferred knowledge base, etc.). Key feature flags: `PIPEDREAM_INTEGRATIONS`, `SCHEDULING`, `DATA_CONNECTORS_ENABLED`, `WORKSPACE_CHAT_AGENT_FUNCTION_URL`.
- Chat transport: Workspace chat streams via the workspace-chat-agent-proxy Lambda (NDJSON). CloudFront injects an `x-arcanum-cloudfront-secret` header; the frontend attaches a Cognito bearer token.
- Integrations UX: When enabled and configured, the chat UI can query connected integrations (via a cross‑account proxy relay). Admins can also set default allow/deny policies for tool usage.

Dev commands:
- `yarn install`, `yarn run dev`, `yarn build`, `yarn test`
- Lint all workspaces (excluding infra): `yarn workspaces foreach --parallel --all --exclude infra run lint --fix`

### Internationalization (i18n)

**IMPORTANT:** All user-facing text in the frontend MUST use i18n translations. Do not hardcode strings.

The frontend uses `react-i18next` for internationalization:

- **Translation files:** `src/locales/en/*.json` (organized by namespace)
- **Hook:** `useTranslation('namespace')` returns a `t()` function
- **Lint enforcement:** ESLint rule `i18next/no-literal-string` will error on hardcoded UI strings

**Common namespaces:**
- `common` - Shared UI elements (buttons, labels, navigation, tool renderers)
- `apps` - Apps pages and components
- `agents` - Agent builder and management
- `chat` - Chat interface
- `auth` - Authentication pages
- `integrations` - Integrations and data connectors
- `knowledgeBase` - Knowledge base management
- `errors` - Error messages

**Usage example:**
```tsx
import { useTranslation } from 'react-i18next';

const MyComponent = () => {
  const { t } = useTranslation('common');

  return (
    <Button>{t('common.save')}</Button>
    <Alert>{t('errors.loadFailed', { message: error })}</Alert>
  );
};
```

**Adding new translations:**
1. Add keys to the appropriate namespace in `src/locales/en/<namespace>.json`
2. Use the `t()` function with the key path (e.g., `t('section.subsection.key')`)
3. For interpolation, use `{{variable}}` in JSON: `"greeting": "Hello, {{name}}!"`
4. Run `yarn lint` to verify no hardcoded strings remain

### Language Picker + LLM Language (single source of truth)

To add a new language option for users and ensure it reaches the LLM prompts, update all of the following:

1. **Picker options (UI):** `numa-frontend/src/Pages/UserProfile.tsx`
   Add a new `<option value="xx">` entry.
2. **Picker label text (i18n):** `numa-frontend/src/locales/en/settings.json`
   Add a new `userProfile.defaults.language.<key>` label for the option.
3. **Supported UI languages:** `numa-frontend/src/i18n/index.ts`
   Add the language code to `supportedLngs` so i18n does not overwrite the user's choice.
4. **LLM language preference storage:** `numa-frontend/src/utils/languagePreference.ts`
   The chosen language is persisted under `numaLanguagePreference` and passed to chat/apps via `getEffectiveLanguage()`.
   Do not add fallback logic here beyond `browser` default behavior.
5. **LLM prompt wording + language names:** `lib/bedrock/bedrock/language.py`
   Add the language code to `LANGUAGE_NAMES`. This file is the single source of truth for the system prompt wording used by both chat and apps.

---

## Legacy Chat Agent — V1 (DEPRECATED) (lambdas/python/numa-chat-agent)

> **DEPRECATED**: Chat V1 has been replaced by the Workspace Chat Agent (see below) as the default chat experience. The `numa-chat-agent` Lambda still exists in the codebase but is no longer the active chat backend. The workspace agent is now at `/chat` in the nav.

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

Frontend integration: The legacy chat page `NumaChatAgents` calls `Services/chatAgentService.ts` for request/stream handling.

---

## Chat Agent (services/numa-workspace-agent)

The `numa-workspace-agent` is the **default and primary chat backend**, running as a containerized Python service on AWS Bedrock AgentCore MicroVMs. It is accessed at `/chat` in the nav. Unlike the deprecated V1, it can **execute arbitrary Python and Bash code in a sandboxed workspace**, manage files, and use a skills/plugins system.

### How Chat differs from deprecated V1

| Aspect | V1 DEPRECATED (`numa-chat-agent`) | Chat (`numa-workspace-agent`) |
|--------|------------------------|----------------------------|
| Runtime | Lambda + LWA (ZIP) | AgentCore MicroVM (Docker on Graviton) |
| AI Framework | Strands agents (Bedrock) | Claude Agent SDK |
| Persistence | Stateless (DynamoDB history only) | Persistent workspace (files synced to S3) |
| Code Execution | Pre‑built tools only | Full Python/Bash in sandbox |
| Session Model | Per‑request (history reconstructed) | Per‑conversation MicroVM (1hr idle, 8hr max) |
| Tool Architecture | Hard‑coded tool functions | MCP tools + skills/plugins system |
| Thinking | Not supported | Extended thinking (up to 10k tokens) |
| File Uploads | 10MB via CloudFront | 200MB via direct S3 |

### Core concepts

- **Per‑conversation MicroVM**: Each conversation gets its own isolated MicroVM (`conv-{conversationId}`). The proxy Lambda routes requests to the correct session. No cross‑conversation contamination.
- **Persistent workspace (`/workdir`)**: Files in `/workdir/uploads/` and `/workdir/outputs/` are per‑conversation and synced to S3 after each request. Users can upload files, and the agent can create/edit files that persist.
- **Skills & plugins**: Located in `/app/plugins/numa/skills/` (read‑only, outside workspace so the AI cannot modify them). Skills include: knowledge‑search, web‑search, pdf‑handling, docx‑handling, spreadsheet‑handling, data‑analysis, integrations, and agents.
- **MCP tools**: `execute_script` (sandboxed Python/Bash/Node), integration tools (`run_action`, `configure_props`, `proxy_request`), and workspace tools (KB query, web search, document conversion, content extraction).
- **Security hooks**: PreToolUse/PostToolUse hooks block dangerous imports (os, subprocess, socket, etc.), directory traversal, access to `.system/` paths, and obfuscation attempts. Container runs as non‑root (UID 1000).
- **Integration prompts**: Custom system prompt extensions for 11+ SaaS tools in `services/numa-workspace-agent/integration-prompts/` (Gmail, Slack, Jira, Notion, SharePoint, Google Drive, HubSpot, Xero, Outlook, etc.).

### Request flow

```
Browser → CloudFront → workspace-chat-agent-proxy (Lambda) → AgentCore MicroVM
                                                                    ↓
                                                              FastAPI /invocations
                                                                    ↓
                                                         Claude SDK query() loop
                                                           (up to 50 agentic turns)
                                                                    ↓
                                                    ┌───────────────┼───────────────┐
                                                    ↓               ↓               ↓
                                                S3 Sync        MCP Tools       DynamoDB
                                            (workspace files)  (code exec,     (metadata,
                                                                KB, search)     approvals)
```

### Key infrastructure

- `infra/constructs/workspace-chat-agent-construct.ts` — ECR repo, AgentCore runtime definition, IAM roles, CloudWatch log groups.
- `infra/constructs/workspace-chat-agent-proxy-construct.ts` — Proxy Lambda that bridges HTTP requests to AgentCore SDK invocations, routing by conversationId.
- `infra/constructs/workspace-chat-tools-construct.ts` — Support Lambda invoked by the workspace agent for KB queries, integration relay, and file operations.

### Frontend integration

- Page: `src/Pages/NumaWorkspaceChatAgents.tsx` at `/chat`
- Service: `src/Services/workspaceChatAgentService.ts`
- Types: `src/types/workspaceChatTypes.ts`
- Components: `src/Components/WorkspaceChat/`
- Streaming hook: `src/hooks/useWorkspaceChatStreaming.ts`

For the full reference (module structure, API contract, tools, skills, debugging, CloudWatch queries), see `services/numa-workspace-agent/README.md`.

---

## Services (Containerized Agents)

The `/services/` directory contains containerized agents deployed on AWS Bedrock AgentCore, as opposed to Lambda‑based functions in `/lambdas/`.

Currently contains:
- `numa-workspace-agent/` — The workspace chat agent (see section above)

### Packaging

Services are packaged as ARM64 Docker images using `package-service.sh`:

```bash
cd services
./package-service.sh numa-workspace-agent
```

**Requirements:** Docker Desktop must be running (uses `docker buildx` for ARM64 cross‑compilation on Graviton).

**Output:** `infra/assets/artifacts/numa-workspace-agent/image.tar`

The script builds with `--platform linux/arm64 --no-cache`, tags with git hash + `latest`, and saves the image as a tar file consumed by CDKTF during deployment (pushed to ECR via `skopeo`).

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
  - Provisions the client's Cognito, API Gateway + authorizer, CloudFront, S3 buckets (outputs, data, frontend), chat DynamoDB tables, Step Functions, Lambdas for apps, the `numa-chat-agent` function URL, and knowledge base(s).
  - Configurable preferred knowledge base: Amazon Q Business or Bedrock KB.
  - Can enable Pipedream integrations by wiring the cross‑account relay Lambda ARN.
  - Workspace Chat constructs (default chat backend):
    - `workspace-chat-agent-construct.ts` — ECR repository, AgentCore runtime, IAM roles, vendedlogs CloudWatch log group.
    - `workspace-chat-agent-proxy-construct.ts` — Proxy Lambda bridging HTTP to AgentCore SDK invocations.
    - `workspace-chat-tools-construct.ts` — Support Lambda for KB queries, integration relay, and file operations.

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
- Feature flags & FE config: `public/config.json` and session storage carry resolved values (client name, region, bucket names, relay ARN, preferred KB, etc.). Key flags:
  - `PIPEDREAM_INTEGRATIONS` — Enable Pipedream SaaS integrations.
  - `WORKSPACE_CHAT_AGENT_FUNCTION_URL` — Direct Lambda URL for workspace chat streaming (bypasses CloudFront buffering).
  - `SCHEDULING` — Enable agent scheduling and notifications.
  - `DATA_CONNECTORS_ENABLED` — Enable data connectors (SharePoint, Teams, Box, Web, S3 sources).

---

## Security Model

- Authentication: Amazon Cognito User Pool + User Pool Client; frontend obtains JWTs for API calls.
- API protection: API Gateway custom authorizer verifies Cognito tokens and CloudFront secret. Chat Function URL sits behind CloudFront; all requests must include the shared secret header.
- Cross‑account access: Deployer assumes roles into client accounts; client chat agent can assume web identity roles as needed; integrations validate caller account identity.
- Secrets: OAuth credentials for integrations are stored in Secrets Manager in the dedicated proxy account.
- Workspace agent isolation: Each conversation runs in its own AgentCore MicroVM. Python security hooks (PreToolUse/PostToolUse) block dangerous imports, directory traversal, and access to system paths. Container runs as non‑root (UID 1000). Plugins are stored outside the workspace (`/app/plugins/`) so the AI cannot modify its own capabilities.
- Partner Revenue Measurement: All AWS SDK calls should carry our AWS Marketplace product code (cl23v3vsno0k35czlg7e3ld9p). Use the shared helpers to append the PRM user agent: Python Lambdas `from prm import client, resource`, Node Lambdas/tools `withPRM` from `lib/prm-node/prm`, and frontend `withPRM` from `src/utils/prmUtils`. This keeps AWS attribution enabled across infra, Lambdas, frontend, and tools.

---

## Development & Deployment

- Frontend
  - Dev: `yarn install`, `yarn run dev`
  - Build before infra deploy: `yarn build`
  - Tests: `yarn test`
  - Lint: `yarn lint` (fix with `--fix`)

- Lambdas (Python)
  - Use Poetry for deps, lint, and tests.
  - Package a single Lambda (preferred): `bash package-python-lambda.sh lambdas/python/<lambda_name>`
  - Package all (slow): `bash package-all.sh`
  - Package a single Node Lambda: `bash package-node-lambda.sh lambdas/node/<lambda_name>`
  - Or manually: `yarn bundle` in the lambda directory

- Services (Docker/AgentCore)
  - Requires Docker Desktop running.
  - Package: `cd services && ./package-service.sh numa-workspace-agent`
  - Force full rebuild (no cache): `DOCKER_BUILD_OPTS="--no-cache" ./package-service.sh numa-workspace-agent`
  - Output: `infra/assets/artifacts/<service-name>/image.tar`
  - Then deploy via CDKTF as usual (image is pushed to ECR).
  - Local dev: `cd services/numa-workspace-agent && poetry install && poetry run uvicorn numa_workspace_agent.main:app --reload --port 8080`

- Infrastructure (CDKTF)
  - Ensure frontend is built and Lambdas are packaged before `cdktf deploy`.
  - Deploy to a target client (example env vars + stack name) using `yarn cdktf deploy --auto-approve <stack>`.

## Branching Strategy

Feature branches → `dev` (default MR target) → `main` (release). No pipeline runs on push to `dev`. Full pipeline (package, build, deploy) runs on push to `main`. Hotfixes can target `main` directly — merge `main` back into `dev` afterwards to stay aligned.

---

## Folder Guide

- `/numa-frontend/` – React app (Pages, Components, Services), including `NumaWorkspaceChatAgents` (chat at `/chat`), `NumaChatAgents` (deprecated V1), and integrations UI.
- `/services/` – Containerized agents for Bedrock AgentCore (e.g., `numa-workspace-agent`). Packaged via `package-service.sh`.
- `/lambdas/python/` – 55+ Python Lambdas (e.g., `numa-chat-agent`, `workspace-chat-agent-proxy`, `workspace-chat-tools`, `extract-content-from-file`, app‑specific steps, Pipedream proxy/relay, web search proxy, etc.).
- `/lambdas/node/` – 29 Node Lambdas for infrastructure/system tasks (authorizers, agents API, scheduling, notifications, branding, cleanup, shims, etc.).
- `/infra/` – CDKTF stacks and constructs for client, deployer, NextGen (account creation), Pipedream proxy, workspace agent, knowledge bases, data sources, and frontend infra.
- `/lib/` – Shared libraries and helpers (Bedrock, S3, PRM, utilities).
- `/tools/` – Operational tools (create users, write/retrieve config, check index progress, reports, etc.).
- `/deployer/` – Streamlit‑based Q Apps deployer tool (manages OAuth, secrets, Q App creation).
- `/numa-customer-success-portal/` – Customer Success Portal frontend (React + Vite).
- `/initial-account-setup/` – CloudFormation templates for initial AWS account bootstrapping.
- `/docs/` – Architecture documentation and task specs.
- `/style/` – Shared ESLint configuration base.

---

## Numa Ops

Numa Ops is a work management / project ops module built into the Numa platform. It was designed by Ian (Product Manager) and is being implemented as a first-class Numa feature. Think of it as a lightweight Jira/Linear-style ops tool, purpose-built for enterprise teams using Numa.

### Concepts

- **Tickets** — The core unit of work. Each ticket has a title, description, status, priority, assignee, due date, and more. Tickets live on kanban boards and in a backlog.
- **Teams** — What Ian's original POC called "boards". A team owns a set of tickets and has its own kanban board.
- **Projects** — Groupings of tickets, linked to a team. Tickets can belong to a project.
- **Customers** — First-class entity. Tickets and projects can be linked to a customer. Has its own tab (not mirrored from CRM — standalone).
- **Suppliers** — Similar to customers. Tickets can be linked to suppliers.
- **Backlog** — A list view of all tickets not yet assigned to an active sprint/board column.
- **Kanban board** — Column-based view of tickets by status (e.g. To Do, In Progress, Done).

### Key Differences from Ian's POC

- Ian called "teams" → "boards". Numa calls them **teams**.
- Customers are their own standalone tab (Ian's version had a CRM mirror concept — we removed that).
- Suppliers are tracked similarly to customers.
- Ian's original design had a "Work Centre" hierarchy above teams. This was removed (with Ian's approval) — companies will only ever have one work centre, so the hierarchy is flat: Ticket → Team.

### Ian's POC

Ian (PM) built a reference implementation called "The actual Work Ops App" — it is the **gold standard** for feature parity. If you have it locally, it lives under `docs/tasks/numa-ops-feature/The actual Work Ops App/` and contains the full field library, status model, and domain logic. The accompanying doc `Numa-Ops-Business-Capabilities.docx` describes the full business vision.

### Implementation

- **Backend**: Node Lambdas in `/lambdas/node/` prefixed with `numa-ops-*` (e.g. `numa-ops-tickets`, `numa-ops-projects`, `numa-ops-teams`, `numa-ops-customers`).
- **Frontend**: Components and pages under `numa-frontend/src/` — look for `NumaOps`, `Ops`, or `ops` in filenames.

### Mental Model for Ops Tasks

- Ian's POC is the gold standard — when in doubt, match his design.
- The structure (lambdas, infra, routing) is largely in place — most work is filling in missing fields, functionality, and UI/UX polish.
- Tickets are the most complex entity — they have many fields, link to other entities (projects, customers, suppliers, other tickets), and appear in multiple views (kanban card, backlog row, ticket detail modal).

---

## Mental Model for Agents

1) If deploying to clients, it runs out of the numa-client-stack where we assume an ArcanumAIAccess role from the deployer accounts creds to be able to create all the resources in the client account. This is also useful for local dev to access/see resources in the client account.
2) For chat tasks, the `numa-workspace-agent` service is the primary chat backend. It runs in an AgentCore MicroVM per conversation, uses the Claude Agent SDK for agentic loops, executes code in a sandboxed environment, and syncs workspace files to S3. The proxy Lambda routes requests; the tools Lambda handles KB queries and integration calls. Accessible at `/chat` in the nav.
3) The legacy `numa-chat-agent` Lambda (V1) is deprecated. It still exists in the codebase but is no longer the default chat experience.
4) For app tasks, follow the app construct → Step Function → Lambda chain, with S3 prefixes in the outputs bucket and optional job status in DynamoDB.
5) For integrations, treat Pipedream access as cross‑account and centrally secured; rely on the relay/proxy pattern.
